# 智权链·锂安溯（TrustGuard Battery）前端 UI/UX 重构总结报告

## 1. 重构审查结论（重构前问题诊断）

在对重构前 8 页面版本进行全站代码与交互审查后，定位出以下主要体验与视觉问题：
1. **信息架构与页面过载**：AI 风控分析与策略预演耦合在 `/approvals` 页面，组织架构与 28 身份矩阵缺乏独立治理视图，不便于按业务职能分组展示。
2. **视觉层级不够统一**：驾驶舱与业务页之间卡片边框、圆角、状态色和表格密度不一致，部分页面存在文字密度偏高、缺少分页与抽屉联动的问题。
3. **电池与联盟链特色有待强化**：电芯/模组/PACK 缺乏工业结构简图；安全攻防实验室（Lab）需要更清晰地分离「网关拦截」「Peer 背书拒绝不提交排序」和「链码门禁拒绝」三类层次；审计页需要单表选中即看关联安全日志与批次锚定的联动视图。
4. **写接口跨站防护加固**：需在 BFF 全部 `POST` 路由统一强制 `application/json` 及 `Origin/Referer` 同源校验。

## 2. 架构与视觉升级实施清单

### 2.1 回滚基线与底层保护
- 已分别在重构启动前于独立目录留存前端压缩备份：
  - `web-pre-redesign-backup.tar`
  - `web-pre-11pages-backup.tar`
- 未修改任何已验收 Go 链码、未重构 Fabric 网络、未篡改 NestJS 与 FastAPI 核心业务逻辑、未清理现有账本及数据库演示数据。

### 2.2 统一设计系统与全局壳层
- 在 `apps/web/src/app/globals.css` 建立完整色彩令牌（深海军蓝 `#0b192c`/`#10243a`、科技蓝 `#2563eb`、青绿 `#0f9d8a`、工业浅灰 `#f4f7fa` 及 4 态标准语义色）。
- 重建 `apps/web/src/components/AppShell.tsx`：升级为 6 大业务组 11 个页面的 240px 深蓝侧边栏 + 64px 顶部全局状态栏（含 24 位编码直达检索、Fabric 实时高度、拦截告警抽屉与 28 身份 mTLS 切换器）。
- 升级 `apps/web/src/components/Badges.tsx` 并新增 `apps/web/src/components/Visuals.tsx`（含 `BatteryStructureSvg`、`LifecycleDonutChart`、`ConsortiumTopologySvg`、`SlideDrawer`、`PaginationBar`）。

### 2.3 页面体系从 8 页升级为 11 页
- **保留并深度重设计 8 个核心业务页面**：
  - `/`（安全驾驶舱）、`/identity`（电池数字身份与 7 段国标标尺/通行证）、`/inspections`（质量检测与 AEAD 加密报告抽屉）、`/trace`（支持滚轮缩放/拖拽/路径高亮的深色网格 DAG 谱系图）、`/approvals`（动态审批矩阵与详情抽屉）、`/transfers`（跨企业双向托管卡片）、`/lab`（A1–A8 四层拦截遥测实验室）、`/audit`（审计证据簿与交易-日志-批次三元联动卡）。
- **新增 3 个高价值专题页面**：
  - `/risk`：独立呈现 FastAPI IsolationForest 离线评估指标（`quality-iforest-v1`）、规则引擎与实时 `QUALITY_GATE` 阻断控制台，配套新增服务端路由 `apps/web/src/app/api/bff/risk/route.ts`。
  - `/policies`：独立呈现策略变更 5 步流水线与「弱化审批门槛」隔离 Go 回归预演对比器。
  - `/organizations`：独立呈现四组织拓扑、11 类证书角色 RBAC 职责矩阵与 28 组脱敏白名单身份切换管理台。

### 2.4 BFF 安全能力增强
- 在 `apps/web/src/lib/server/session.ts` 新增 `verifyCsrf(request)` 并接入全部 7 个 POST BFF 路由（`/api/bff/session`、`commands/[resource]`、`release-request`、`policy-preview`、`reports/[id]/revoke`、`inspections`、`lab/run`）。
- 在 `apps/web/src/lib/server/attack-runner.ts` 为 A1–A8 返回结构新增 `telemetry`（含拦截层次 `interceptionLayer`、`reachedFabric`、`endorsed`、`submitted`、`writtenToBlock` 及 5 步执行时间线）。

### 2.5 移动端真机截图巡检发现与修复
- 首次浏览器截图检查（`final_step_53.png`）发现 390px 窄屏下顶部组织徽章换行挤压及 `/identity` 24 位编码框文字右侧裁切问题：
  1. 为 `OrgBadge` 添加 `whitespace-nowrap shrink-0` 防止组织标签文字折行；
  2. 在 `AppShell.tsx` 移动端顶栏（`<640px`）自动隐藏外层 `OrgBadge` 并为身份选择器设置 `max-w-[165px] truncate`；
  3. 在 `/identity` 输入框窄屏样式中减小字距与右侧留白，使 24 位编码在 390px 屏幕上完整清晰显示。
- 修复后经重新构建与浏览器复检（`final_step_69.png`），顶部单行展示与 24 位编码可视化均正常。

---

## 3. 第二阶段全栈完善（全业务交互闭环、多体系 AI/对照/压测与自动化 E2E）

在 11 页面视觉重构基础上，进一步补全了全部交互闭环、竞赛对照实验与工程化质量保障：

1. **BFF 与业务交互闭环补全（18 -> 21 路由）**：
   - 新增 `/api/bff/imports/measurements`（Ed25519 演示源签名 CSV 量测导入与 AI 实时筛查）、`/api/bff/imports/health`（受控 BMS 健康快照导入）、`/api/bff/risk/operations`（mTLS 直连 FastAPI NetworkX 图异常检测）；在 `/api/bff/commands/[resource]` 增补 `autoHashes` SHA-256 摘要计算，在 `/api/bff/risk` 聚合加载消融对照与并发压测报告。
   - `/identity`：新增「新建批次 / 24 位码建档」抽屉（原料批次→生产批次→24 位编码电芯/模组/PACK 链上建档）、BMS 健康快照导入表单、以及「日期更正」提案/批准/应用全流程交互。
   - `/inspections`：新增「签名 CSV 导入 & AI 筛查」标签页，与 AEAD 加密报告抽屉协同工作。
   - `/trace`：新增「装配授权与绑定管理」抽屉（`assembly-authorizations` 供货授权与 `assembly` 边绑定），并在图谱与路径台账中支持历史版本切换。
   - `/policies`：打通 `policy-candidates` 候选提交、四组织逐一 `policy-approvals` 会签与 `policy-activations` 一键激活闭环。
   - `/risk`：新增可交互 NetworkX 有向企业协作环路 SVG 图示（「注入跨机构极速互批闭环」实时触发 `REQUIRES_REVIEW` 判定）、基线 A / 基线 B vs 智权链完整方案 C 消融对照面板与高并发限流基准展示。
2. **多体系 AI 数据升级、对照实验与性能压测**：
   - 升级 `services/risk/trustguard_risk/datasets.py` 固定种子数据集（`seed=20261115`）为 `LFP` + `TERNARY` 双体系跨批次数据集（600 训练集 + 200 测试集，`batchOverlap: 0`），同时覆盖单步故障与联合漂移异常。
   - 新增 `services/api/scripts/verify-ablation.mjs`（基线 A/B vs 完整方案 C 7 场景对照实验）、`tests/perf/concurrent-load.mjs` 与 `tests/perf/k6-battery-load.js` 并发压测与 `429 RATE_LIMITED` 突刺验证，以及 `infrastructure/scripts/contest_ready.py` 赛前只读一键巡检脚本。
3. **工程质量、安全核验与端到端稳定性修复**：
   - 配置 ESLint 9（`eslint-config-next`）与 Playwright 无头 Chromium E2E 回归（`apps/web/tests/e2e.spec.ts`），并在根 `package.json` 为 `@typescript-eslint/typescript-estree` 配置 `minimatch` 覆盖以保持 `npm audit` 0 漏洞。
   - 排查端到端高频导航触发 `cell-viewer` 每分钟 120 次只读限流的问题：修复 `AppShell.tsx`、`/`、`/identity` 与 `/audit` 首屏加载时 `actor` 未解析前后的重复拉取，并将 `/lab` 攻防总览查询切换为独立只读身份通道与限流容错。
