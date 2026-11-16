# 智权链·锂安溯（TrustGuard Battery）前端视觉设计系统规范

本文档记录 `apps/web` 重构后的统一视觉设计系统与工程规范，所有样式令牌定义于 `apps/web/src/app/globals.css`，共享基础组件位于 `apps/web/src/components/`。

## 1. 设计定位与场景原则

- **核心气质**：现代工业科技风 + 企业级 SaaS + 动力电池数字化产线 + 联盟链安全可视化。
- **反模板约束**：摒弃传统后台白卡堆叠及过度渐变/霓虹拟态效果，采用深海军蓝控制台（驾驶舱与攻防实验室）结合高留白浅色工作区（业务流转、审批、台账、风控、组织治理）的双表面对比体系。
- **信息真实原则**：保留明确的数据来源标签（`SourceTag` / `DemoTag`），对不支持硬件扫码与未采集字段（如剩余寿命推算）显式标注边界状态，禁止以静态假数据掩盖真实接口响应。

## 2. 色彩系统（CSS Variables）

全部设计变量声明于 `apps/web/src/app/globals.css` `:root`：

| 语义分类 | 变量名 | 色值 | 主要用途 |
| --- | --- | --- | --- |
| 深色主表面 | `--navy-950` | `#0b192c` | `.navy-control-panel`、`.trace-dark-grid` 网格控制舱底色 |
| 深色主导航/横幅 | `--navy-900` | `#10243a` | 240px 侧边导航栏、`.page-header-strip`、`.navy-subcard` |
| 深色交互面板 | `--navy-800` | `#17324f` | 深色悬停卡片、抽屉顶栏内嵌按钮底色 |
| 品牌科技蓝 | `--tech-blue` | `#2563eb` | 主操作按钮、当前激活导航项、标准交互焦点 |
| 能源青绿 | `--teal-core` | `#0f9d8a` | 联盟通道焦点、`PackOrgMSP` 徽章、LFP/能量流高亮 |
| 主页面背景 | `--bg-main` | `#f4f7fa` | 应用主体画布底色 |
| 卡片内容底 | `--bg-card` | `#ffffff` | `.card-surface` 企业工作台白卡与表格表面 |
| 次级表面底 | `--bg-subtle` | `#edf2f7` | `.subtle-surface` 分组底框、输入框与徽章浅底 |
| 主正文文字 | `--text-main` | `#172b3a` | 标题与表体高对比深青灰文字 |
| 次级说明文字 | `--text-secondary` | `#64748b` | 表格列头、副标题、辅助说明 |
| 弱化辅助文字 | `--text-muted` | `#94a3b8` | 占位符、禁用状态与空状态图标 |
| 统一描边 | `--border-color` | `#dce4ee` | 1px 卡片边框、表格分割线与表单边框 |
| 成功/通行态 | `--status-success` | `#159b76` | `QC_PASSED`、`ledger-verified`、Peer 在线状态 |
| 警告/待复核态 | `--status-warning` | `#d99a2b` | `REVIEW_REQUIRED`、DEMO 徽章、BDU 高压组件着色 |
| 危险/拦截态 | `--status-danger` | `#dc5353` | `QC_REJECTED`、`rejected`/`invalid`、A1–A8 阻断标牌 |
| 信息强调态 | `--status-info` | `#3185d8` | `LabOrgMSP` 标牌、钠离子与检测散点图高亮 |

## 3. 排版、字体与网格布局体系

- **字体栈**：中文采用 `PingFang SC` / `Microsoft YaHei` / `Noto Sans SC` 现代无衬线字体；区块高度、哈希值、24 位 GB/T 34014 编码、错误码与指标数值统一采用 `.mono` 等宽字体及 `font-variant-numeric: tabular-nums` 等宽数字对齐。
- **桌面端主框架（`apps/web/src/components/AppShell.tsx`）**：
  - 左侧固定主导航栏：宽 `240px`（`lg:block`，移动端折叠为抽屉菜单），分 6 大业务组承载 11 个页面（01–11）。
  - 顶部全局状态栏：高 `64px`（`h-16`），集成面包屑定位、24 位编码快速直达检索框、Fabric 共识高度与 mTLS 状态 pill、安全拦截通知铃铛，以及服务端 28 白名单身份切换器。
  - 主内容区：`max-w-[1600px]` 居中约束，8px 倍数间距（`p-4 sm:p-6`，`gap-4`/`gap-5`）。
- **视觉表面类**：
  - `.navy-control-panel`：深蓝底 + `24px × 24px` 工程细网格 + `#1c3554` 边框 + `12px` 圆角。
  - `.card-surface`：白底 + `#dce4ee` 1px 边框 + `12px` 圆角 + `0 1px 3px rgba(16, 36, 58, 0.04)` 轻量投影。
  - `.trace-dark-grid`：`#0b192c` 底色 + `28px × 28px` 拓扑图网格。

## 4. 共享业务组件规范

### 4.1 徽章与状态组件（`apps/web/src/components/Badges.tsx`）
- `QualityBadge`：统一映射 `QC_PASSED`（绿）、`QC_REJECTED`（红）、`REVIEW_REQUIRED`（琥珀）、`NOT_TESTED`（灰）。
- `LifecycleBadge`：映射 `REGISTERED`、`ASSEMBLED`、`RELEASED`、`IN_USE`、`RETIRED`、`RECEIVED_FOR_RECYCLING`、`PROCESSED`。
- `OrgBadge`：按 `CellOrgMSP` / `PackOrgMSP` / `LabOrgMSP` / `RecycleOrgMSP` 区分浅色与深色模式边框配色，强制 `whitespace-nowrap shrink-0` 防止窄屏徽章折行。
- `StagePill`：标准展示 Fabric 幂等交易生命周期阶段（`ledger-verified`、`committed`、`endorsed`、`rejected`、`invalid`）。
- `HashChip`：一键复制完整 SHA-256 哈希、txId 与 `requestId`，支持深/浅双主题。
- `PageBanner` / `SectionHeader` / `BatteryQrBadge` / `TxResultBanner` / `EmptyState` / `SourceTag` / `DemoTag`。

### 4.2 工业 SVG 与交互组件（`apps/web/src/components/Visuals.tsx`）
- `BatteryStructureSvg`：分别绘制方壳单体电芯（`CELL`）、串并联电池模组（`MODULE`）及含 BDU 与高压母排的动力电池包总成（`PACK`）工业结构简图。
- `LifecycleDonutChart`：环形生命周期资产分布图与图例。
- `ConsortiumTopologySvg`：四组织 Peer 节点（`:17051`/`:19051`/`:21051`/`:23051`）与 Raft Orderer（`:17050`）`batterybusiness` 通道实时拓扑图，支持深/浅两种底色。
- `SlideDrawer`：统一右侧滑出详情取证抽屉（深海军蓝顶栏 + 可滚动详情内容区）。
- `PaginationBar`：统一表格分页控件。
