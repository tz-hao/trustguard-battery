import { expect, test, type Page } from '@playwright/test';

const actor = {
  name: 'pack-approver',
  mspId: 'PackOrgMSP',
  role: 'approver',
  orgLabel: 'PACK 装配企业',
  roleLabel: '审批人',
  fingerprintPrefix: 'test',
};
const now = new Date('2026-11-18T02:00:00Z');
const hash = 'a'.repeat(64);
const certificate = (id: string, expiresAt: string, riskExpiresAt: string, state = 'PENDING') => ({
  id, packId: 'test-pack', state, expiresAt,
  requiredOrgs: ['PackOrgMSP'], approvals: [], policyVersion: 1,
  snapshotHash: hash, txId: hash,
  risk: { id: 'risk-test', level: 'LOW', modelVersion: 'test', expiresAt: riskExpiresAt },
});
const approvals = {
  currentPolicy: { version: 1, requiredOrgs: ['PackOrgMSP'], highRiskOrgs: [], simulationOnly: true },
  releases: [
    certificate('release-valid', '2026-11-18T02:05:00Z', '2026-11-18T02:00:02Z'),
    certificate('release-expired', '2026-11-18T01:59:00Z', '2026-11-18T02:05:00Z'),
    certificate('release-completed', '2026-11-18T01:00:00Z', '2026-11-18T01:00:00Z', 'COMPLETED'),
  ],
  packs: [],
};
const audit = { transactions: [], securityLogs: [], auditBatches: [], auditorRoleActive: false, ledgerAudits: [] };

async function stubOverview(page: Page, endpoint: string, outcomes: number[], data: unknown) {
  await page.route('**/api/bff/dashboard', r => r.fulfill({ json: { summary: {} } }));
  await page.route('**/api/bff/session', r => r.fulfill({ json: { actor, identities: [actor] } }));
  await page.route('**/api/bff/' + endpoint, r => {
    const status = outcomes.shift() ?? 200;
    return r.fulfill({ status, json: status === 200 ? data : { code: 'RATE_LIMITED' } });
  });
}

for (const scenario of [
  { path: '/approvals', api: 'releases', payload: approvals, dataText: '四组织联合审批矩阵', refresh: '刷新' },
  { path: '/audit', api: 'audit', payload: audit, dataText: '暂无匹配的交易台账记录', refresh: '刷新取证台账' },
]) {
  test(scenario.path + ' distinguishes a rate limit from empty data and retries', async ({ page }) => {
    await stubOverview(page, scenario.api, [429, 200, 429, 200], scenario.payload);
    await page.goto(scenario.path);
    await expect(page.getByRole('alert').getByText(/HTTP 429/)).toBeVisible();
    await expect(page.getByText(scenario.dataText, { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: '重试加载' }).click();
    await expect(page.getByText(scenario.dataText, { exact: false })).toBeVisible();
    await expect(page.getByRole('alert').getByText(/HTTP 429/)).toHaveCount(0);

    await page.getByRole('button', { name: scenario.refresh, exact: true }).click();
    await expect(page.getByRole('alert').getByText(/上次成功加载的记录/)).toBeVisible();
    await expect(page.getByText(scenario.dataText, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '重试加载' }).click();
    await expect(page.getByRole('alert').getByText(/HTTP 429/)).toHaveCount(0);
  });
}

test('pending releases expire while open and cannot submit an approval or finalization', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.valueOf() + 1000));
  await stubOverview(page, 'releases', [200], approvals);
  let requests = 0;
  await page.route('**/api/bff/commands/**', r => {
    requests++;
    return r.abort();
  });
  await page.goto('/approvals');

  const card = (id: string) => page.locator('div.subtle-surface').filter({ has: page.getByText(id, { exact: true }) });
  const finalize = (id: string) => card(id).getByRole('button', { name: /执行最终放行/ });
  const approve = (id: string) => card(id).getByRole('button', { name: /以 pack-approver 批准/ });
  await expect(finalize('release-valid')).toBeEnabled();
  await expect(approve('release-valid')).toBeEnabled();
  await expect(finalize('release-expired')).toBeDisabled();
  await expect(approve('release-expired')).toBeDisabled();
  await expect(card('release-completed').getByText(/已批准放行/)).toBeVisible();

  await page.clock.fastForward(3000);
  await expect(card('release-valid').getByText('已过期', { exact: true })).toBeVisible();
  await expect(finalize('release-valid')).toBeDisabled();
  await expect(approve('release-valid')).toBeDisabled();
  await card('release-valid').getByRole('button', { name: '放行详情' }).click();
  await expect(page.getByText('风险凭证有效期至', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭抽屉' }).click();

  await page.getByRole('button', { name: '待审批', exact: true }).click();
  await expect(page.getByText('该筛选条件下暂无放行申请')).toBeVisible();
  await page.getByRole('button', { name: '已过期', exact: true }).click();
  await expect(card('release-expired')).toBeVisible();
  await expect(card('release-valid')).toBeVisible();
  expect(requests).toBe(0);
});
