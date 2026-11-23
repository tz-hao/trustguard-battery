import { expect, test } from '@playwright/test';

const ROUTES = [
  { path: '/', heading: '动力电池全生命周期可信追溯与主动安全驾驶舱' },
  { path: '/identity', heading: '动力电池数字身份证与按码查询工作台' },
  { path: '/inspections', heading: '动力电池质量检测中心与加密报告存证' },
  { path: '/trace', heading: '动力电池全链条谱系追溯中心' },
  { path: '/approvals', heading: '多组织联合审批中心' },
  { path: '/transfers', heading: '跨企业双向交接与退役回收流转管理' },
  { path: '/risk', heading: 'AI 质量与操作双轨风险分析中心' },
  { path: '/policies', heading: '安全策略变更预演与多组织治理中心' },
  { path: '/lab', heading: '区块链安全攻防实验室' },
  { path: '/audit', heading: '区块链审计与交易取证中心' },
  { path: '/organizations', heading: '四组织联盟架构与 28 身份 mTLS 权限治理中心' },
];

test.describe('TrustGuard Battery 11-Page E2E Suite', () => {
  test.beforeEach(async ({ context }) => {
    const baseUrl = process.env.TRUSTGUARD_WEB_URL ?? 'http://127.0.0.1:3100';
    await context.addCookies([
      { name: 'tg_actor', value: 'cell-admin', url: baseUrl },
      { name: 'tg_login_gate', value: '1', url: baseUrl },
    ]);
  });

  test('all 11 pages render without console/page errors or horizontal overflow on desktop & mobile', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    // Desktop 1440x900
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const r of ROUTES) {
      await page.goto(r.path, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: new RegExp(r.heading) })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `Desktop horizontal overflow on ${r.path}`).toBe(false);
    }

    // Mobile 390x844 spot checks on core & interactive layouts
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mobilePath of ['/', '/identity', '/risk', '/lab', '/organizations']) {
      await page.goto(mobilePath, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `Mobile horizontal overflow on ${mobilePath}`).toBe(false);
    }

    expect(errors).toEqual([]);
  });

  test('/identity parses invalid GB/T 34014 code & opens batch/asset registration drawer', async ({ page }) => {
    await page.goto('/identity', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /非法编码反例/ }).click();
    await expect(page.getByText(/CODE_CHEMISTRY|编码不符合/).first()).toBeVisible();

    await page.getByRole('button', { name: /新建批次 \/ 24 位码建档/ }).click();
    await expect(page.getByText(/步骤 1：创建原料批次/)).toBeVisible();
    await page.getByRole('button', { name: '关闭抽屉' }).click();
  });

  test('/inspections opens AEAD report drawer and switches to CSV measurement form', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '签名 CSV 导入 & AI 筛查' }).click();
    await expect(page.getByText(/LIMS 签名 CSV 量测数据导入/)).toBeVisible();

    const decryptBtn = page.getByRole('button', { name: '解密读取' }).first();
    if (await decryptBtn.isVisible()) {
      await decryptBtn.click();
      await expect(page.getByText(/加密报告安全检视/)).toBeVisible();
      await page.getByRole('button', { name: '关闭抽屉' }).click();
    }
  });

  test('/trace supports zoom controls & opens assembly drawer', async ({ page }) => {
    await page.goto('/trace', { waitUntil: 'networkidle' });
    await page.getByTitle('放大').click();
    await expect(page.getByText('115%')).toBeVisible();

    await page.getByRole('button', { name: '装配授权与绑定管理' }).click();
    await expect(page.getByText(/电芯装配供应授权/)).toBeVisible();
    await page.getByRole('button', { name: '关闭抽屉' }).click();
  });

  test('/risk runs NetworkX collusion cycle graph', async ({ page }) => {
    await page.goto('/risk', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '注入跨机构极速互批闭环' }).click();
    await expect(page.getByText(/NetworkX 判定：REQUIRES_REVIEW/)).toBeVisible();
  });

  test('/lab executes A1 real attack & verifies Peer rejection with zero state change', async ({ page }) => {
    await page.goto('/lab', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '运行 A1', exact: true }).click();
    await expect(page.getByText(/ATTACK BLOCKED · 拦截生效/)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/SHA-256 完全一致 · 零污染/)).toBeVisible();
  });

  test('/audit updates linked forensic card and switches logs/batches tabs', async ({ page }) => {
    await page.goto('/audit', { waitUntil: 'networkidle' });
    await expect(page.getByText(/关联取证档案卡/)).toBeVisible();
    await page.getByRole('button', { name: /Ed25519 安全事件日志/ }).click();
    await expect(page.getByText(/操作者证书哈希/)).toBeVisible();
    await page.getByRole('button', { name: /批次摘要锚定/ }).click();
    await expect(page.getByText(/本地归档锚定批次/)).toBeVisible();
  });
});
