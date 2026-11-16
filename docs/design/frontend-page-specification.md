# 智权链·锂安溯（TrustGuard Battery）11 页面交互与功能规格说明书

重设计后的前端由原 8 页面扩展为 **6 大业务域、11 个独立路由页面**，统一通过服务端 Next.js BFF（18 个路由）代理访问 mTLS API（`https://localhost:13000/api/v1`）与 Fabric 账本，浏览器端不持有密钥也不自宣称身份。

## 1. 全局导航分组与路由表

| 业务组 | 编号 | 页面名称 | 路由 | 页面文件 | 主要 BFF 接口 |
| --- | --- | --- | --- | --- | --- |
| 工作台 | 01 | 安全驾驶舱 | `/` | `apps/web/src/app/page.tsx` | `/api/bff/dashboard`, `/api/bff/assets`, `/api/bff/audit` |
| 电池管理 | 02 | 电池数字身份 | `/identity` | `apps/web/src/app/identity/page.tsx` | `/api/bff/battery`, `/api/bff/assets`, `/api/bff/commands/[resource]` |
| 电池管理 | 03 | 质量检测中心 | `/inspections` | `apps/web/src/app/inspections/page.tsx` | `/api/bff/inspections`, `/api/bff/assets`, `/api/bff/reports/[id]/content`, `/api/bff/reports/[id]/revoke` |
| 电池管理 | 04 | 电池谱系追溯 | `/trace` | `apps/web/src/app/trace/page.tsx` | `/api/bff/trace`, `/api/bff/batches`, `/api/bff/assets` |
| 企业协作 | 05 | 联合审批中心 | `/approvals` | `apps/web/src/app/approvals/page.tsx` | `/api/bff/releases`, `/api/bff/release-request`, `/api/bff/commands/[resource]` |
| 企业协作 | 06 | 企业交接管理 | `/transfers` | `apps/web/src/app/transfers/page.tsx` | `/api/bff/transfers`, `/api/bff/assets`, `/api/bff/commands/[resource]` |
| 智能风控 | 07 | AI 风险分析 | `/risk` | `apps/web/src/app/risk/page.tsx` | `/api/bff/risk`, `/api/bff/lab/run` |
| 智能风控 | 08 | 安全策略管理 | `/policies` | `apps/web/src/app/policies/page.tsx` | `/api/bff/releases`, `/api/bff/policy-preview`, `/api/bff/commands/[resource]` |
| 区块链安全 | 09 | 安全攻防实验室 | `/lab` | `apps/web/src/app/lab/page.tsx` | `/api/bff/lab/run` |
| 区块链安全 | 10 | 区块链审计中心 | `/audit` | `apps/web/src/app/audit/page.tsx` | `/api/bff/audit`, `/api/bff/transactions/[requestId]` |
| 系统管理 | 11 | 组织与权限管理 | `/organizations` | `apps/web/src/app/organizations/page.tsx` | `/api/bff/session`, `/api/bff/dashboard`, `/api/bff/audit` |

## 2. 逐页核心功能与安全设计规范

### 01. 安全驾驶舱（`/`）
- **定位**：深色工业级全生命周期监控驾驶舱（`.navy-control-panel`）。
- **核心模块**：
  - 资产规模、质检异常、放行/交接待办、策略版本与账本高度 KPI 卡片；
  - `LifecycleDonutChart` 生命周期分布环形图与电化学体系占比条；
  - 四组织协同拓扑图（`ConsortiumTopologySvg`）与 PostgreSQL 索引同步块高对比；
  - 实时安全拦截与业务动态流 + 3 项竞赛场景（未装配电芯、使用中 PACK、已报废确认）与批次谱系直达入口。

### 02. 电池数字身份（`/identity`）
- **定位**：基于 GB/T 34014—2017 及第 1 号修改单的数字身份证与按码查询工作台。
- **核心模块**：
  - 24 位编码实时长度计数输入框、硬件扫码未接入显式禁用提示、6 组标准/反例快捷按钮；
  - 7 段 GB/T 34014 交互式标尺（X1–X3 厂商、X4 产品、X5 材料、X6–X7 规格、X8–X14 追溯、X15–X17 日期、X18–X24 序列号），支持错误位置精确高亮；
  - 双列数字通行证（属性与字段级来源哈希检验 vs `BatteryStructureSvg` 结构简图与数字矩阵 QR 码、使用年限、设计寿命、SOH、报废信息边界显式标注）；
  - 5 节点生命周期时间轴、链上历史/检测/装配边/更正标签页、受控 BMS 健康鉴权提示、生命周期推进表单及筛选分页台账表。

### 03. 质量检测中心（`/inspections`）
- **定位**：电芯质检量测分析、AEAD 加密报告签发及受控解密撤权工作台。
- **核心模块**：
  - 检测总量/合格率/待复核统计卡、电芯容量 vs 内阻深色散点图、AI 辅助评分展示（明确 `qualityConclusion: null` 人工决策边界）；
  - 版本化质量检测签发表单（本地私钥签名 + 加密报告上传 + 链码版本校验）；
  - 右侧 `SlideDrawer` 抽屉：在线触发 AEAD 密钥服务授权解密，以及管理员撤权后实时拒解核验。

### 04. 电池谱系追溯（`/trace`）
- **定位**：可交互 DAG 电池装配关系与批次影响范围追溯图谱。
- **核心模块**：
  - 四视角追溯切换（按电芯批次正向追溯、电芯/模组正向影响、PACK 反向拆解组成、历史变更与装配边）；
  - `.trace-dark-grid` 交互式 SVG 图谱画布：支持滚轮缩放、控制条放大/缩小/重置、画布平移、单节点自由拖拽、当前边与历史边切换及上游/下游关联路径高亮；
  - 点击节点弹出右侧 `SlideDrawer` 展现节点资产档案、质检记录与报告哈希；底部联动受影响 PACK 路径表格与 PG 索引同步状态。

### 05. 联合审批中心（`/approvals`）
- **定位**：多组织联合放行审批矩阵、AI 风险凭证绑定与放行时效监控中心。
- **核心模块**：
  - 动态依据政策 `requiredOrgs` 渲染每个审批单的组织签章矩阵，不写死固定组织数量；
  - 右侧 `SlideDrawer` 解释放行单快照哈希、关联 AI `RiskAttestation` 凭证、过期时间及拒绝原因；
  - 发起新放行申请与多组织会签执行操作（严格由服务端证书所属 MSP 与 `approver`/`release` 角色校验）。

### 06. 企业交接管理（`/transfers`）
- **定位**：跨企业双向持有人托管交接状态机工作台。
- **核心模块**：
  - 双签持有人流转约束栏及 `PROCESSED` 终态防回流提示；
  - 筛选标签页与分页交接流转卡片，突出 `[转出方 MSP] -> [接收方 MSP]` 方向、双向确认状态与发起/确认/取消操作。

### 07. AI 风险分析（`/risk`）
- **定位**：AI 风险分析、规则引擎与主动质量门禁联合可视化页面（新增独立页面）。
- **核心模块**：
  - FastAPI 风控引擎就绪态、IsolationForest（`quality-iforest-v1`）离线评估指标（`precision`、`recall`、`f1`、`falsePositiveRate`、`latencyP95Ms`）及与规则基线对比；
  - 规则引擎与 NetworkX 图特征协同说明；
  - 含缺陷电芯拦截实时联动控制台（一键执行 `A2`，完整展现 5 步执行线与 `QUALITY_GATE` 链码拦截凭证）；
  - 电芯量测特征评分明细与已签发 `RiskAttestation` 风险凭证清单。

### 08. 安全策略管理（`/policies`）
- **定位**：策略配置、候选提交、隔离 Go 回归预演与多组织审批激活治理页面（新增独立页面）。
- **核心模块**：
  - 5 步策略安全发布流水线与当前激活策略参数基线；
  - 「弱化审批门槛反例（仅 PackOrgMSP）」与「安全参数微调」一键隔离预演运行器；
  - 可展开预演详情面板，直观看见 `authorizationDifference`（`before` vs `after` 组织集合差异）及各项 Go 回归测试用例执行结果与耗时。

### 09. 安全攻防实验室（`/lab`）
- **定位**：A1–A8 全栈实网对抗验证与四层拦截定界实验室。
- **核心模块**：
  - 覆盖 A1（冒充检测员，Peer 背书拒绝且不提交排序）至 A8（非授权企业报废篡改）全部 8 类实时攻防场景，支持单点或 `ALL` 全量执行；
  - 服务端注入证书信息（名称、MSP、角色、TLS 指纹前缀）与攻击接入点标注；
  - Fabric 提案生命周期 4 阶段定位（到达 Fabric / Peer 背书 / Orderer 排序 / 写块落盘）、5 步执行时间线、攻击前后 SHA-256 账本摘要一致性核验与请求/响应 JSON 原始报文终端。

### 10. 区块链审计中心（`/audit`）
- **定位**：全链交易取证、Ed25519 安全事件日志与批次摘要锚定证据簿。
- **核心模块**：
  - 区分 `ledger-verified`（四节点核验通过）、`rejected`（背书拒绝）与 `invalid`（区块验证无效）；
  - `requestId` 实时对账终端（调用 `/api/bff/transactions/[requestId]`，展示发起者证书隐私隔离行为）；
  - 交易台账与下方「关联取证档案卡」联动展示交易主记录、对应 Ed25519 安全审计日志摘要及 `AuditBatch` 链上锚定交易；
  - 专属 `auditor` 角色直查链码 `audit` 记录区域。

### 11. 组织与权限管理（`/organizations`）
- **定位**：四组织联盟网络、11 类业务角色与 28 组服务端白名单身份治理页面（新增独立页面）。
- **核心模块**：
  - 四组织（`CellOrgMSP`、`PackOrgMSP`、`LabOrgMSP`、`RecycleOrgMSP`）职责卡、Gateway Peer 端口与 `ConsortiumTopologySvg` 网络拓扑；
  - 11 类角色（`manufacturer`、`inspector`、`assembler`、`release`、`approver`、`custodian`、`operator`、`recycler`、`admin`、`auditor`、`viewer`）链码与网关权限职责矩阵；
  - 可按组织/角色筛选的 28 组脱敏白名单身份列表（仅显示指纹前缀，不暴露私钥/路径）及同源 CSRF 与 mTLS 边界声明。
