import { expect, test } from '@playwright/test';
import { startTransferWeb } from '../../../tests/fixtures/transfer_web.mjs';

test('1.4 原包预演显示窗口差异，刷新可继续提案，改签名时拒绝审批',async({page}) => {
  test.setTimeout(90_000);
  const site=await startTransferWeb({withPolicy:true});
  try {
    await page.goto(site.url+'/policies');
    await page.getByLabel('切换服务端 mTLS 白名单身份').selectOption('cell-admin');
    const seconds=page.getByLabel('候选放行窗口（秒）');
    const preview=page.getByRole('button',{name:'推演合规策略'});
    await seconds.fill('59');
    await expect(preview).toBeDisabled();
    await seconds.fill('540');
    await preview.click();
    await expect(page.getByText('放行窗口 600 秒 → 540 秒')).toBeVisible({timeout:45_000});
    await page.reload();
    await expect(page.getByRole('button',{name:/提交为链上候选提案/})).toBeEnabled();
    await expect(page.getByText('放行窗口 600 秒 → 540 秒')).toBeVisible();
    const [saved]=site.previews;
    expect(saved.passed).toBe(true);
    expect(saved.report.ruleProof.version).toBe('1.4');
    expect(saved.report.changedFields).toEqual(['releaseSeconds','version']);
    expect(saved.report.tests.every(row=>row.result==='pass')).toBe(true);
    const candidate={id:saved.id,testsHash:saved.tests_hash,policy:{...site.currentPolicy,version:2,releaseSeconds:540}};
    const reviewer={identity:{role:'auditor'}};
    await site.policyService.requirePassed(reviewer,candidate);
    saved.signature=Buffer.alloc(64).toString('base64');
    await expect(site.policyService.requirePassed(reviewer,candidate)).rejects.toMatchObject({response:{code:'POLICY_PREVIEW_EVIDENCE_INVALID'}});
  } finally {await site.close();}
});
