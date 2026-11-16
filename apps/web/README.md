# Web 前端应用（智权链·锂安溯）

基于 Next.js 16.4.6、React 19.3.1、TypeScript、Tailwind CSS v4 与 ESLint / Playwright 构建的动力电池全生命周期可信追溯与主动安全防护工作台（6 大业务组、11 个独立页面、21 个 Next.js BFF 路由）。

## 11 页面导航清单

- **工作台**
  - `/`：01 安全驾驶舱（首屏骨架屏、全局资产规模、生命周期环形分布、材料占比、四组织协同拓扑、PG/Fabric 同步块高、实时安全事件流）
- **电池管理**
  - `/identity`：02 电池数字身份（GB/T 34014—2017+A1:2026 7 段交互标尺、新建批次与 24 位码建档抽屉、数字身份证、工业 SVG 结构简图与 QR、受控 BMS 健康档案及快照导入、生命周期推进、日期更正提案审批与分页台账）
  - `/inspections`：03 质量检测中心（检测统计、容量-内阻散点分布、LIMS 签名 CSV 量测导入与 AI 实时筛查、版本化报告签发、抽屉式 AEAD 授权解密与撤权）
  - `/trace`：04 电池谱系追溯（正向/反向/批次/历史四视角，深色网格可缩放拖拽有向谱系图、节点证据抽屉、受影响 PACK 路径台账及装配授权绑定/拆解抽屉）
- **企业协作**
  - `/approvals`：05 联合审批中心（按当前策略 `requiredOrgs` 动态生成多组织审批矩阵、AI 风险凭证详情抽屉、放行申请与会签）
  - `/transfers`：06 企业交接管理（双签持有人流转卡片、发起/确认/取消状态机与 `PROCESSED` 终态防回流约束）
- **智能风控**
  - `/risk`：07 AI 风险分析（IsolationForest `quality-iforest-v1` 离线评估指标、NetworkX 跨组织极速互批环路交互演示、A2 主动门禁联动、基线 A/B vs 实验 C 对照数据与高并发限流基准展示）
  - `/policies`：08 安全策略管理（5 步治理流水线、`weak` vs `safe` 隔离 Go 回归预演对比、链上候选提案 `policy-candidates`、四组织 `policy-approvals` 会签与 `policy-activations` 激活闭环）
- **区块链安全**
  - `/lab`：09 安全攻防实验室（A1–A8 全量/单点实网攻防对抗、四层拦截精准定界、Fabric 背书/排序漏斗、5 步遥测时间线与前后状态 SHA-256 一致性校验）
  - `/audit`：10 区块链审计中心（`requestId` 实时对账终端、`ledger-verified`/`rejected`/`invalid` 台账与关联取证档案卡、Ed25519 日志与批次摘要锚定、`auditor` 链上直查）
- **系统管理**
  - `/organizations`：11 组织与权限管理（四组织职责与 Peer 节点拓扑、11 类业务角色 RBAC 职责矩阵、服务端 28 组脱敏白名单身份列表与切换台）

## 架构、安全边界与命令

- **零前端密钥与 CSRF 防护**：浏览器不直连 mTLS API（`https://localhost:13000`），不持有私钥，也不通过请求头自宣称身份；所有请求经服务端 `/api/bff/*` 代理，按 HttpOnly Cookie `tg_actor` 映射至服务端 `identities.json` 白名单证书，并在全部写入路由强制执行 `verifyCsrf` 同源及 `application/json` 校验。
- **质量与自动化测试命令**：
  - 规范检查：`npm run lint --workspace @trustguard/web`
  - 类型检查：`npm run check:types --workspace @trustguard/web`
  - 生产构建：`npm run build --workspace @trustguard/web`
  - 浏览器 E2E 回归：`npm run test:e2e --workspace @trustguard/web`
  - 赛前一键就绪：`.venv/bin/python infrastructure/scripts/contest_ready.py`
  - 进程启动：`.venv/bin/python infrastructure/scripts/business_services.py start --service web`（监听 `http://127.0.0.1:3100`）
