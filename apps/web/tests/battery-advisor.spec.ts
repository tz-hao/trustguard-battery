import {expect,test} from '@playwright/test';

test('模拟档案的风险解释、证据问答、引用展开和刷新回读',async({page,baseURL})=>{
  if (!baseURL || !['127.0.0.1','localhost'].includes(new URL(baseURL).hostname)) throw new Error('Fixture test requires a loopback URL');
  const code='SMACB010000001E119876543';
  const actor={name:'lab-inspector',mspId:'LabOrgMSP',orgLabel:'检测站',role:'inspector',roleLabel:'检测员',fingerprintPrefix:'fixture'};
  const asset={id:'ai-fixture',code,type:'CELL',model:'demo',makerCode:'SMA',makerMSP:'CellOrgMSP',holderMSP:'CellOrgMSP',simulation:true,
    chemistry:'LFP',state:'REGISTERED',quality:'QC_REJECTED',children:[],inspectionVersion:1,version:2,txId:'fixture-tx',evidence:{source:'FABRIC_COMMITTED_STATE'}};
  let latest:unknown=null;
  const tasks:string[]=[];
  await page.route('**/api/bff/**',async route=>{
    const req=route.request(),u=new URL(req.url());
    const send=(json:unknown)=>route.fulfill({json});
    switch(u.pathname.split('/').pop()){
      case 'session':return send({actor,identities:[actor]});
      case 'assets':return send({assets:[asset]});
      case 'battery':return send({codeValid:true,registered:true,battery:asset,rawCode:code,history:[]});
      case 'ai':
        if(req.method()==='GET')return send(u.searchParams.has('assetId')?{latest}:{available:true});
        const input=req.postDataJSON();
        expect(input.assetId).toBe(asset.id);
        if(input.task==='trace_question')expect(input.question).toBe('哪条检测记录？');
        tasks.push(input.task);
        latest={requestId:input.requestId,assetId:asset.id,state:'completed',result:{model:'fixture',generatedAt:'2026-11-18T00:00:00Z',
          analysis:{summary:{text:'检测记录需要复核',evidenceIds:['E1']},findings:[],reviewSuggestions:[],unknowns:[]},
          references:[{evidenceId:'E1',kind:'inspection',resourceId:'inspection-1',txId:'inspection-tx'}],
          evidence:[{id:'E1',kind:'inspection',facts:{version:1,result:'QC_REJECTED'}}]}};
        return send(latest);
      case 'scans':return send([]);
      default:return send({});
    }
  });
  await page.goto('/identity?code='+code);
  const panel=page.getByRole('region',{name:'DeepSeek 风险与证据'});
  await page.getByRole('link',{name:'问 AI · 查看风险依据'}).click();
  await panel.getByRole('button',{name:'为什么有风险？'}).click();
  await panel.getByRole('button',{name:'依据 E1'}).click();
  await expect(panel.locator('details[open]')).toContainText('inspection-tx');
  await panel.getByLabel('关于这块电池的问题').fill('哪条检测记录？');
  await panel.getByRole('button',{name:'提问并查看依据'}).click();
  await expect(panel.getByRole('article')).toContainText('检测记录需要复核');
  await page.reload();
  await expect(panel.getByRole('article')).toContainText('检测记录需要复核');
  expect(tasks).toEqual(['risk_explanation','trace_question']);
});
