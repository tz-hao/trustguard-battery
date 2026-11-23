import {expect,test,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const code='SMACB010000001E119876543';
const actor={name:'lab-inspector',mspId:'LabOrgMSP',orgLabel:'检测站',role:'inspector',roleLabel:'检测员',fingerprintPrefix:'fixture'};
const asset={id:'cell-one',code,type:'CELL',state:'REGISTERED',quality:'QC_PASSED',makerMSP:'CellOrgMSP',makerCode:'SMA',holderMSP:'CellOrgMSP',
  batchId:'same-batch',chemistry:'LFP',model:'demo',manufacturedAt:'2024-01-01',manufactureSourceHash:'manufacture-proof',simulation:true,
  firstUseAt:null,serviceAge:null,designLifeMonths:96,updatedAt:'2024-02-02T00:00:00Z',version:2,txId:'later-change',assemblyVersion:0,
  children:[],evidence:{source:'FABRIC_COMMITTED_STATE'},inspectionVersion:1};
const other={...asset,id:'cell-two'}, moduleA={...asset,id:'module-A',type:'MODULE'}, packA={...asset,id:'pack-A',type:'PACK'};
async function setup(page:Page){
  const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/api/bff/**',async route=>{
    const u=new URL(route.request().url());
    switch(u.pathname.split('/').pop()){
      case 'session':return route.fulfill({json:{actor,identities:[actor]}});
      case 'assets':return route.fulfill({json:{assets:[asset,other,moduleA,packA]}});
      case 'batches':return route.fulfill({json:{batches:[{id:'same-batch',cells:[],cellCount:2}]}});
      case 'battery':return route.fulfill({json:{rawCode:code,codeValid:true,registered:true,battery:asset,
        history:[{txId:'registered-tx',at:'2024-01-01T00:00:00Z',actorMSP:'CellOrgMSP',value:{...asset,version:1}},
          {txId:'later-change',at:asset.updatedAt,value:asset}],health:{allowed:true,data:{sohPct:96,measuredAt:asset.updatedAt,sourceHash:'health-proof'}}}});
      case 'trace':{
        const first=u.searchParams.get('assetId')===asset.id;
        return route.fulfill({json:{mode:'asset',asset:first?asset:other,ancestry:first?[moduleA,packA]:[]}});
      }
      case 'scans':return route.fulfill({json:route.request().method()==='POST'?{site:'检测站',previousSite:'电芯厂'}:[]});
      case 'mes':return route.fulfill({json:{completed:true,result:{version:3},txId:'mes-test'}});
      case 'inspections':
        if(route.request().method()==='POST') return route.fulfill({json:{command:{completed:true,txId:'signed-test'}}});
        return route.fulfill({json:u.searchParams.has('subject')?{state:{inspectionVersion:1,quality:'QC_REJECTED'},proposal:{proposedTx:'proposal-1'},reports:[]}:
          {measurements:[],reports:[],inspections:[]}});
      default:return route.fulfill({status:404,json:{code:'NOT_FOUND'}});
    }
  });
  return errors;
}
test('二维码图像识别、错误图像、相机拒绝、档案刷新',async({page})=>{
  const errors=await setup(page); await page.goto('/identity');
  const badge=page.locator('svg').filter({has:page.locator('title',{hasText:'扫描打开电池档案'})});
  const png=await badge.screenshot();
  await page.getByLabel('识别二维码图片').setInputFiles({name:'battery.png',mimeType:'image/png',buffer:png});
  await expect(page).toHaveURL(new RegExp('code='+code));
  await page.reload();await expect(badge).toBeVisible();
  await page.getByLabel('识别二维码图片').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('invalid')});
  await expect(page.getByRole('alert').filter({hasText:/图像|image|decode|source/i}).first()).toBeVisible();
  await page.getByRole('button',{name:'相机扫码查档'}).click();
  await expect(page.getByText(/相机不可用或未获授权/)).toBeVisible();
  // Feed the actual rendered QR into Chromium's camera pipeline; no physical device is used.
  await page.evaluate(async data => {
    const img = new Image();
    img.src = 'data:image/png;base64,'+data; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width=360; canvas.height=360;
    const ctx = canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const stream=canvas.captureStream(10);
      const timer=setInterval(()=>{ctx.drawImage(img,0,0,360,360);if(stream.getTracks().every(t=>t.readyState==='ended')) clearInterval(timer);},100);
      return stream;
    }});
  },png.toString('base64'));
  await page.getByLabel('扫码时登记本站').check();
  const read=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/bff/battery');
  await page.getByRole('button',{name:'相机扫码查档'}).click();await read;
  await expect(page.getByLabel('扫码相机画面')).toHaveCount(0);
  await expect(page.getByText('异地冲突预警：电芯厂 → 检测站')).toBeVisible();
  expect(errors).toEqual([]);
});
test('逐字段原始来源、测量时间、缺失记录',async({page})=>{
  const errors=await setup(page); await page.setViewportSize({width:390,height:844});await page.goto('/identity?code='+code);
  await page.getByRole('button',{name:'生产日期',exact:true}).click();
  await expect(page.locator('#proof-manufacturedAt')).toContainText('registered-tx');
  await expect(page.locator('#proof-manufacturedAt')).not.toContainText('later-change');
  await page.getByRole('button',{name:'SOH 健康度（授权读取）'}).click();await expect(page.locator('#proof-sohPct')).toContainText('health-proof');
  await expect(page.getByText(/测量于/)).toBeVisible();
  await page.getByRole('button',{name:'实际退役日期'}).click();await expect(page.locator('#proof-retiredAt')).toContainText('暂无已确认记录');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});
test('单电芯正向查询与未装配状态',async({page})=>{
  const errors=await setup(page);await page.goto('/trace?cellId=cell-one');
  await expect(page.getByText(/当前装配路径.*cell-one.*module-A.*pack-A/)).toBeVisible();
  const request=page.waitForRequest(r=>r.url().includes('assetId=cell-two&view=forward'));
  await page.getByLabel('正向追溯电芯').selectOption('cell-two');await request;
  await expect(page.getByText(/当前装配路径.*cell-two.*未装配/)).toBeVisible();
  await page.reload();await expect(page.getByText(/当前装配路径.*cell-two.*未装配/)).toBeVisible();expect(errors).toEqual([]);
});
test('批次独立复检提交包含原版本',async({page})=>{
  const errors=await setup(page);await page.goto('/inspections');
  await page.getByLabel('质检对象').selectOption('batch:same-batch');
  await page.getByLabel('检测说明或复检理由').fill('已独立复测');
  const req=page.waitForRequest(r=>r.url().endsWith('/bff/inspections')&&r.method()==='POST');
  await page.getByRole('button',{name:'独立签发复检'}).click();
  expect((await req).postDataJSON()).toMatchObject({assetId:'batch:same-batch',retest:true,expectedVersion:1});
  await expect(page.getByText('已核验交易 signed-test')).toBeVisible();expect(errors).toEqual([]);
});
test('MES 示例上传与确认',async({page})=>{
  await setup(page);await page.goto('/identity');
  const file=await readFile(new URL('../public/examples/mes-production.json',import.meta.url));
  await page.getByLabel('生产或装配文件').setInputFiles({name:'mes.json',mimeType:'application/json',buffer:file});
  const req=page.waitForRequest(r=>r.url().endsWith('/imports/mes'));await page.getByRole('button',{name:'导入 MES 文件'}).click();
  expect((await req).postDataJSON()).toEqual(JSON.parse(file.toString()));await expect(page.getByText(/已核验 3 行/)).toBeVisible();
});
test('现场确认后显示异地冲突',async({page})=>{
  await setup(page);await page.goto('/identity?code='+code);await page.getByRole('button',{name:'登记本站扫码'}).click();
  await expect(page.getByText('异地冲突预警：电芯厂 → 检测站')).toBeVisible();
});
