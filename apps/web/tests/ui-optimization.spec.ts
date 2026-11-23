import { expect, test, type Page } from '@playwright/test';

const IDENTITIES = [
  { name: 'cell-admin', mspId: 'CellOrgMSP', role: 'admin', orgLabel: '电芯制造企业 (CellOrg)', roleLabel: '组织管理员', fingerprintPrefix: 'aa:11:22:33' },
  { name: 'cell-manufacturer', mspId: 'CellOrgMSP', role: 'manufacturer', orgLabel: '电芯制造企业 (CellOrg)', roleLabel: '生产制造员', fingerprintPrefix: 'aa:11:22:44' },
  { name: 'cell-approver', mspId: 'CellOrgMSP', role: 'approver', orgLabel: '电芯制造企业 (CellOrg)', roleLabel: '联合审批员', fingerprintPrefix: 'aa:11:22:55' },
  { name: 'cell-viewer', mspId: 'CellOrgMSP', role: 'viewer', orgLabel: '电芯制造企业 (CellOrg)', roleLabel: '只读观察员', fingerprintPrefix: 'aa:11:22:66' },
  { name: 'pack-manufacturer', mspId: 'PackOrgMSP', role: 'manufacturer', orgLabel: 'PACK 装配企业 (PackOrg)', roleLabel: '生产制造员', fingerprintPrefix: 'bb:11:22:33' },
  { name: 'pack-assembler', mspId: 'PackOrgMSP', role: 'assembler', orgLabel: 'PACK 装配企业 (PackOrg)', roleLabel: '模组/PACK 装配员', fingerprintPrefix: 'bb:11:22:44' },
  { name: 'pack-custodian', mspId: 'PackOrgMSP', role: 'custodian', orgLabel: 'PACK 装配企业 (PackOrg)', roleLabel: '资产交接保管员', fingerprintPrefix: 'bb:11:22:55' },
  { name: 'pack-operator', mspId: 'PackOrgMSP', role: 'operator', orgLabel: 'PACK 装配企业 (PackOrg)', roleLabel: '运维/装车登记员', fingerprintPrefix: 'bb:11:22:66' },
  { name: 'lab-inspector', mspId: 'LabOrgMSP', role: 'inspector', orgLabel: '第三方检测机构 (LabOrg)', roleLabel: '质检签发员', fingerprintPrefix: 'cc:11:22:33' },
  { name: 'lab-auditor', mspId: 'LabOrgMSP', role: 'auditor', orgLabel: '第三方检测机构 (LabOrg)', roleLabel: '组织审计员', fingerprintPrefix: 'cc:11:22:44' },
  { name: 'recycle-custodian', mspId: 'RecycleOrgMSP', role: 'custodian', orgLabel: '退役回收企业 (RecycleOrg)', roleLabel: '资产交接保管员', fingerprintPrefix: 'dd:11:22:33' },
  { name: 'recycle-recycler', mspId: 'RecycleOrgMSP', role: 'recycler', orgLabel: '退役回收企业 (RecycleOrg)', roleLabel: '退役回收确认员', fingerprintPrefix: 'dd:11:22:44' },
];

const PACK_ONE = {
  id: 'pack-alpha',
  code: 'DMAPE010000001E110000101',
  type: 'PACK',
  makerCode: 'DMA',
  makerMSP: 'PackOrgMSP',
  chemistry: 'TERNARY',
  model: 'sim-3000',
  holderMSP: 'PackOrgMSP',
  simulation: true,
  manufacturedAt: '2024-01-01',
  designLifeMonths: 96,
  state: 'IN_USE',
  statusLabel: '使用中',
  quality: 'QC_PASSED',
  version: 5,
  assemblyVersion: 1,
  children: ['mod-1'],
  inspectionVersion: 1,
  installedAt: '2024-02-01T00:00:00Z',
  firstUseAt: '2024-03-01T00:00:00Z',
  serviceAge: { years: 2, months: 8, days: 18 },
  retiredAt: null,
  recyclingReceivedAt: null,
  scrappedAt: null,
  scrapped: false,
  updatedAt: '2026-11-18T00:00:00Z',
  txId: 'a'.repeat(64),
  evidence: { txId: 'a'.repeat(64), updatedAt: '2026-11-18T00:00:00Z', simulation: true, source: 'FABRIC_COMMITTED_STATE' },
};

const PACK_TWO = {
  ...PACK_ONE,
  id: 'pack-beta',
  code: 'DMAPB010000001E110000202',
  chemistry: 'LFP',
  state: 'RELEASED',
  statusLabel: '已放行',
  version: 3,
  installedAt: null,
  firstUseAt: null,
  serviceAge: null,
};

const CELL_BOUND = {
  ...PACK_ONE,
  id: 'cell-bound',
  code: 'SMACB010000001E110000303',
  type: 'CELL',
  makerCode: 'SMA',
  makerMSP: 'CellOrgMSP',
  holderMSP: 'CellOrgMSP',
  state: 'ASSEMBLED',
  statusLabel: '已装配',
  parentId: 'mod-1',
  children: [],
};

const MODULE_BOUND = {
  ...PACK_ONE,
  id: 'mod-1',
  code: 'DMAMB010000001E110000404',
  type: 'MODULE',
  state: 'ASSEMBLED',
  statusLabel: '已装配',
  children: ['cell-bound'],
};

async function installMockBackend(page: Page, initialActorName = 'cell-viewer', initialAuthenticated = true) {
  let currentActor = IDENTITIES.find(i => i.name === initialActorName) ?? IDENTITIES[0];
  let isAuth = initialAuthenticated;
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.route('**/api/bff/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const segments = u.pathname.split('/').filter(Boolean);
    const tail = segments[segments.length - 1];

    if (tail === 'session') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as { actorName?: string; logout?: boolean };
        if (body.logout) {
          isAuth = false;
          return route.fulfill({ json: { actor: currentActor, authenticated: false } });
        }
        const found = IDENTITIES.find(i => i.name === body.actorName);
        if (found) currentActor = found;
        isAuth = true;
        return route.fulfill({ json: { actor: currentActor, authenticated: true } });
      }
      return route.fulfill({ json: { actor: currentActor, identities: IDENTITIES, authenticated: isAuth } });
    }

    if (tail === 'dashboard') {
      return route.fulfill({
        json: {
          summary: {
            totalAssets: 4,
            cells: 1,
            modules: 1,
            packs: 2,
            passedAssets: 4,
            rejectedAssets: 0,
            reviewRequiredAssets: 0,
            notTestedAssets: 0,
            pendingReleases: 1,
            pendingTransfers: 1,
            activePolicyVersion: 2,
            ledgerHeight: '720',
            indexedBlock: '720',
            stale: false,
            indexedUpdatedAt: '2026-11-18T00:00:00Z',
            chaincode: { name: 'battery', version: '1.5', sequence: '6' },
            riskReady: true,
            auditLogsTotal: 12,
            auditAnchoredTotal: 12,
            auditPendingTotal: 0,
            auditBatchesTotal: 2,
            rejectedTxCount: 3,
          },
          recentAssets: [PACK_ONE, PACK_TWO, MODULE_BOUND, CELL_BOUND],
          batches: [{ id: 'batch-1', makerMSP: 'CellOrgMSP', materialLotIds: ['lot-1'], simulation: true, cellCount: 1, passedCount: 1, rejectedCount: 0, reviewRequiredCount: 0, notTestedCount: 0 }],
          pendingReleases: [],
          pendingTransfers: [],
          recentRejections: [],
          recentAlerts: [],
          organizations: [
            { mspId: 'CellOrgMSP', label: '电芯制造企业', gatewayEndpoint: 'localhost:17051', roles: [{ name: 'cell-manufacturer', role: 'manufacturer' }] },
            { mspId: 'PackOrgMSP', label: 'PACK 装配企业', gatewayEndpoint: 'localhost:19051', roles: [{ name: 'pack-assembler', role: 'assembler' }] },
            { mspId: 'LabOrgMSP', label: '第三方检测机构', gatewayEndpoint: 'localhost:21051', roles: [{ name: 'lab-inspector', role: 'inspector' }] },
            { mspId: 'RecycleOrgMSP', label: '退役回收企业', gatewayEndpoint: 'localhost:23051', roles: [{ name: 'recycle-recycler', role: 'recycler' }] },
          ],
          simulationData: true,
        },
      });
    }

    if (tail === 'assets') {
      return route.fulfill({ json: { assets: [PACK_ONE, PACK_TWO, MODULE_BOUND, CELL_BOUND] } });
    }

    if (tail === 'batches') {
      return route.fulfill({ json: { batches: [{ id: 'batch-1', cellCount: 1, cells: [CELL_BOUND] }] } });
    }

    if (tail === 'battery') {
      const code = u.searchParams.get('code') ?? PACK_ONE.code;
      const found = [PACK_ONE, PACK_TWO, MODULE_BOUND, CELL_BOUND].find(a => a.code === code) ?? PACK_ONE;
      return route.fulfill({
        json: {
          codeValid: true,
          rawCode: found.code,
          registered: true,
          battery: found,
          health: { allowed: true, data: { sohPct: 96.5, cycleCount: 142, measuredAt: '2026-11-18T00:00:00Z', sourceHash: 'b'.repeat(64) } },
          history: [{ txId: found.txId, at: found.updatedAt, value: found }],
          inspections: [],
          edges: [],
          corrections: [],
        },
      });
    }

    if (tail === 'transfers') {
      return route.fulfill({ json: { transfers: [], packs: [PACK_ONE, PACK_TWO] } });
    }

    if (tail === 'trace') {
      return route.fulfill({
        json: {
          mode: 'batch',
          batchMeta: { id: 'batch-1', makerMSP: 'CellOrgMSP', materialLotIds: ['lot-1'], cells: [CELL_BOUND] },
          modules: [MODULE_BOUND],
          trace: {
            batchId: 'batch-1',
            current: { packIds: ['pack-alpha'] },
            historical: { packIds: ['pack-alpha'], paths: [{ cellId: 'cell-bound', moduleId: 'mod-1', packId: 'pack-alpha', historical: false }] },
            packs: [PACK_ONE],
            indexedBlock: '720',
            ledgerHeight: '720',
            stale: false,
            updatedAt: '2026-11-18T00:00:00Z',
          },
        },
      });
    }

    if (tail === 'assembly-authorizations') {
      return route.fulfill({
        json: { completed: false, stage: 'rejected', errorCode: 'INVALID_SUPPLY', requestId: 'req-supply-1' },
      });
    }

    if (tail === 'assembly') {
      return route.fulfill({
        json: { completed: false, stage: 'rejected', errorCode: 'INVALID_ASSEMBLY', requestId: 'req-asm-1' },
      });
    }

    if (tail === 'audit') {
      return route.fulfill({ json: { transactions: [], securityLogs: [], auditBatches: [], auditorRoleActive: false, ledgerAudits: [] } });
    }

    if (tail === 'ai') {
      return route.fulfill({ json: u.searchParams.has('assetId') ? { latest: null } : { available: false, reason: 'AI_DISABLED' } });
    }

    if (tail === 'scans') {
      return route.fulfill({ json: [] });
    }

    return route.fulfill({ json: {} });
  });

  return errors;
}

test('未登录访问根路径与子路由均严格停留登录门户，展示官方 Logo 与全部岗位角色（无隐藏），登录后裁剪菜单与支持侧边栏折叠', async ({ page }) => {
  const errors = await installMockBackend(page, 'cell-viewer', false);
  await page.goto('/transfers');

  // Unauthenticated visit to /transfers stays on Login Portal without ever showing backend workspace
  await expect(page.getByRole('heading', { name: '智权链 · 锂安溯' })).toBeVisible();
  await expect(page.locator('img[src="/brand/logo-full.jpg"]')).toBeVisible();
  await expect(page.getByText('选择所属企业')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);

  // All roles of selected enterprise are shown directly (no hidden collapse toggle)
  await page.getByRole('button', { name: /电芯制造企业/ }).click();
  await expect(page.getByRole('button', { name: /生产制造员/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /只读观察员/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /组织管理员/ })).toBeVisible();
  await expect(page.getByText(/更多角色/)).toHaveCount(0);

  await page.getByRole('button', { name: /生产制造员/ }).click();
  await page.getByRole('button', { name: /登录进入工作台/ }).click();

  await expect(page).toHaveURL(/\/identity/);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '电池数字身份' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '电池谱系追溯' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '企业交接管理' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '联合审批中心' })).toHaveCount(0);

  // Sidebar collapse & expand toggle works
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await page.getByRole('button', { name: '展开侧边栏' }).click();

  // Direct URL visit to unauthorized module shows access guard
  await page.goto('/transfers');
  await expect(page.getByRole('heading', { name: /当前岗位无权访问「企业交接管理」/ })).toBeVisible();

  // Escape hatch switches back to full demo view
  await page.getByRole('button', { name: '临时切换至全局演示视图' }).click();
  await expect(page.getByRole('heading', { name: /跨企业双向交接/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('优化 1 + Bug 1：生命周期事件电池切换下拉框 & 24位码建档角色预检与日期自动同步', async ({ page }) => {
  const errors = await installMockBackend(page, 'cell-manufacturer');
  await page.goto('/identity?code=' + PACK_ONE.code);

  // Optimization 1: Switch battery right inside Lifecycle Event card
  const packSelect = page.getByLabel('选择推进生命周期的电池');
  await expect(packSelect).toHaveValue('pack-alpha');
  await packSelect.selectOption('pack-beta');
  await expect(page.getByText('pack-beta').first()).toBeVisible();

  // Bug 1: Open registration drawer as cell-manufacturer and pick MODULE -> immediate guidance, not silent mystery FORBIDDEN
  await page.getByRole('button', { name: /新建批次 \/ 24 位码建档/ }).click();
  await page.getByLabel('层级类型（按组织授权）').selectOption('MODULE');
  await expect(page.getByText(/电池模组 \(MODULE\).*须由 pack-manufacturer 登记/)).toBeVisible();

  // Changing manufacturedAt auto-updates X15-X17 in 24-char code (2025-05-12 => F5C)
  await page.getByLabel('制造日期 (manufacturedAt)').fill('2025-05-12');
  await expect(page.getByLabel('24 位标准编码（X15–X17 自动与制造日期同步）')).toHaveValue(/^DMAMB010000001F5C\d{7}$/);

  await page.getByRole('button', { name: '关闭抽屉' }).click();
  expect(errors).toEqual([]);
});

test('优化 2：企业交接单发出凭证 SHA-256 系统自动生成与实时有效性校验', async ({ page }) => {
  const errors = await installMockBackend(page, 'pack-custodian');
  await page.goto('/transfers');

  const input = page.getByLabel('发出凭证 SHA-256');
  const submit = page.getByRole('button', { name: '创建交接单' });
  await expect(submit).toBeDisabled();

  await input.fill('not-a-valid-hex');
  await expect(page.getByText(/格式无效：仅允许十六进制字符/)).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.getByRole('button', { name: '系统自动生成' }).click();
  await expect(input).toHaveValue(/^[0-9a-f]{64}$/);
  await expect(submit).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Bug 2：谱系装配抽屉准确区分业务校验错误（INVALID_SUPPLY / INVALID_ASSEMBLY）而非误报证书错误', async ({ page }) => {
  const errors = await installMockBackend(page, 'cell-manufacturer');
  await page.goto('/trace');

  await page.getByRole('button', { name: '装配授权与绑定管理' }).click();
  await expect(page.getByText(/状态预检提示.*INVALID_SUPPLY/)).toBeVisible();

  await page.getByRole('button', { name: /提交供货装配授权/ }).click();
  await expect(page.getByText(/供货授权条件不满足/)).toBeVisible();
  await expect(page.getByText(/错误码: INVALID_SUPPLY/)).toBeVisible();

  await page.getByRole('button', { name: /执行装配绑定 \/ 版本化拆解/ }).click();
  await expect(page.getByText(/装配规则校验未通过/)).toBeVisible();
  await expect(page.getByText(/错误码: INVALID_ASSEMBLY/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('核心重设计页面在桌面与移动端零横向溢出', async ({ page }) => {
  const errors = await installMockBackend(page, 'cell-admin');
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(vp);
    for (const path of ['/login', '/', '/identity', '/transfers', '/trace', '/organizations']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `Overflow at ${vp.width}x${vp.height} on ${path}`).toBe(false);
    }
  }
  expect(errors).toEqual([]);
});
