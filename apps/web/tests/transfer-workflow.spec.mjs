import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { startTransferWeb } from '../../../tests/fixtures/transfer_web.mjs';

test('分别发出、签收、提交，刷新读回持有方，旧接口也经过四阶段', async ({page}) => {
  test.setTimeout(90_000);
  const site = await startTransferWeb();
  const receipt = createHash('sha256').update('simulated physical receipt').digest('hex');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(site.url+'/transfers');
    const actors = page.getByLabel('切换服务端 mTLS 白名单身份');
    const actAs = async name => {
      await actors.selectOption(name);
      await expect(actors).toHaveValue(name);
      await expect(page.getByText(new RegExp('当前身份：' + name))).toBeVisible();
    };
    const read = async () => (await page.request.get(site.url+'/api/bff/transfers')).json();
    await expect(page.getByRole('button',{name:'创建交接单'})).toBeDisabled();
    await actAs('pack-custodian');
    await page.getByLabel('选择交接电池包').selectOption('fixture-pack');
    await page.getByLabel('目标接收机构').selectOption('CellOrgMSP');
    await page.getByLabel('发出凭证 SHA-256').fill(receipt);
    await page.getByRole('button',{name:'创建交接单'}).click();
    await expect(page.getByText('待发出 (CREATED)',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'发出交接单'}).click();
    await expect(page.getByText('待签收 (SENT)',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'签收凭证'})).toBeDisabled();
    await actAs('cell-custodian');
    await page.getByLabel('所收凭证 SHA-256').fill('0'.repeat(64));
    await page.getByRole('button',{name:'签收凭证'}).click();
    await expect(page.getByText('错误码: FORBIDDEN')).toBeVisible();
    await expect(page.getByText('待签收 (SENT)',{exact:true})).toBeVisible();
    await page.getByLabel('所收凭证 SHA-256').fill(receipt);
    await page.getByRole('button',{name:'签收凭证'}).click();
    await expect(page.getByText('待提交 (ACCEPTED)',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByText('待提交 (ACCEPTED)',{exact:true})).toBeVisible();
    await expect(page.getByText('当前持有方 PackOrgMSP',{exact:true})).toBeVisible();
    let data = await read();
    expect(data.packs[0]).toMatchObject({holderMSP:'PackOrgMSP',version:7});
    await page.getByRole('button',{name:'提交持有权变更'}).click();
    await expect(page.getByText('已完成 (COMMITTED)',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByText('当前持有方 CellOrgMSP',{exact:true})).toBeVisible();
    data = await read();
    expect(data.packs[0]).toMatchObject({holderMSP:'CellOrgMSP',version:8});
    const row = data.transfers[0];
    expect(new Set([row.createdTx,row.sentTx,row.acceptedTx,row.committedTx]).size).toBe(4);
    await page.getByLabel('目标接收机构').selectOption('PackOrgMSP');
    await page.getByLabel('发出凭证 SHA-256').fill(receipt);
    await page.getByRole('button',{name:'创建交接单'}).click();
    await page.getByRole('button',{name:'取消交接',exact:true}).click();
    await expect(page.getByText('已取消 (CANCELLED)',{exact:true})).toBeVisible();
    // Pre-existing HTTP clients use two requests. The controller obtains four distinct receipts.
    const command = async (resource,requestId,data) => {
      const response=await page.request.post(site.url+'/api/bff/commands/'+resource,{data:{requestId,data}});
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    const original = {id:'legacy-client',packId:'fixture-pack',toMSP:'PackOrgMSP',receiptHash:receipt,
      expiresAt:new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z')};
    const sent=await command('transfers','legacy-send',original);
    expect(sent.completed).toBe(true);
    expect(await command('transfers','legacy-send',original)).toEqual(sent);
    await actAs('pack-custodian');
    const body = {id:original.id,receiptHash:receipt};
    const done=await command('transfer-confirmations','legacy-finish',body);
    expect(done.completed).toBe(true);
    expect(await command('transfer-confirmations','legacy-finish',body)).toEqual(done);
    data = await read();
    expect(data.packs[0]).toMatchObject({holderMSP:'PackOrgMSP',version:9});
    const legacy=data.transfers.find(t=>t.id===original.id);
    expect(legacy.state).toBe('COMMITTED');
    expect([legacy.createdTx,legacy.sentTx,legacy.acceptedTx,legacy.committedTx].every(Boolean)).toBe(true);
    expect(new Set([legacy.createdTx,legacy.sentTx,legacy.acceptedTx,legacy.committedTx]).size).toBe(4);
    expect(errors).toEqual([]);
  } finally {await site.close();}
});
