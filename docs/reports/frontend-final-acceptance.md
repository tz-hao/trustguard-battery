# 智权链·锂安溯（TrustGuard Battery）前端最终验收报告

## 1. 验收结论与交付物清单

`apps/web` 已按现代工业科技与企业级能源 SaaS 标准完成全面重构，升级为 **6 大业务域、11 个独立页面、18 个 Next.js BFF 路由**，并保留全部既有后端连接（Fabric 2.5.16 四组织网络、Go 链码 `battery v1.3 / sequence 4`、NestJS mTLS API、FastAPI 风控、MinIO 加密存储与独立密钥服务）。

**核心文档交付物：**
- 设计系统规范：`docs/design/frontend-design-system.md`
- 11 页面功能规格：`docs/design/frontend-page-specification.md`
- 重构实施与问题修复报告：`docs/reports/frontend-redesign-report.md`
- 最终验收报告（本文档）：`docs/reports/frontend-final-acceptance.md`
- 同步更新的使用说明：`apps/web/README.md`、`README.md`

---

## 2. 编译、安全与后端基线测试结果

所有检查均在最终代码修改及重启 `http://127.0.0.1:3100` 服务后实测完成：

| 验收项目 | 执行命令 / 范围 | 实际结果 | 备注 |
| --- | --- | --- | --- |
| TypeScript 类型检查 | `npm run check:types --workspace @trustguard/web` | 通过（0 错误） | 覆盖全部 11 页面与 18 路由 |
| Next.js 生产构建 | `npm run build --workspace @trustguard/web` | 通过（27/27 静态页 worker） | `next build` 编译及 TS 校验均退出码 0 |
| ESLint 状态核查 | 检查 `package.json` 与 `node_modules/.bin` | 未配置/未安装 | 项目未定义 `lint` 脚本且无 `eslint` 二进制 |
| 源码密钥泄漏扫描 | `grep` 扫描 `apps/web/src/` | 通过 | 无 `NEXT_PUBLIC_*` 或硬编码私钥，证书仅在 `server/api-client.ts` 读取 |
| 环境工具链检查 | `npm run check:env` | 通过（`PASS`） | Node/Go/Python/Fabric CLI/Next/Gateway SDK 齐备 |
| 后端 API 单元测试 | `npm test --workspace @trustguard/api` | 7/7 通过（0 失败） | AEAD 加解密、Key Permit、服役年限、终态及错误映射 |
| Python 风控与配置测试 | `pytest services/risk/tests tests/test_business_config.py -q` | 13/13 通过（4.60s） | IsolationForest/规则分析及业务配置校验 |
| 基线资源保留检查 | `infrastructure/scripts/check-preservation.py` | 通过（`PASS`） | 原有容器、镜像、卷与 Hermes/Node 环境完整保留 |

---

## 3. 全站 11 页面、BFF、CSRF、RBAC 与 A1–A8 实网测试结果

测试脚本在重建并重启 `127.0.0.1:3100` 生产服务后执行，全部断言零跳过通过：

### 3.1 11 个页面路由可达性（均返回 HTTP 200）
- `/`、` /identity`、`/inspections`、`/trace`、`/approvals`、`/transfers`、`/risk`、`/policies`、`/lab`、`/audit`、`/organizations` 全部返回 `HTTP 200`，SSR 页面标记完整且无 `Application error`。

### 3.2 BFF 数据链路核验
- 共 13 项 GET 请求全部 `HTTP 200`：`/api/bff/session`（返回 28 组白名单身份且无 `privateKey`/`certPath`/`keyPath` 字段泄漏）、`dashboard`、`assets`、`batches`、`inspections`、`transfers`、`releases`、`risk`（加载 `quality-iforest-v1` 评估指标 `f1=0.847457627118644`）、`audit`、`battery?code=DMAPB010000001E114616111`、`trace?batchId=lab-a4-1c77e1ff-batch`、`reports/a4-rep-8fb7b0e6/content`、`transactions/audit-2152-2167-850ef8815996`。

### 3.3 CSRF 与白名单边界验证
- 伪造跨域 `Origin: https://evil.example` 请求 `POST /api/bff/session`：被拒绝，返回 `HTTP 403`（`CSRF_ORIGIN_MISMATCH`）。
- 非 `application/json` 请求体（`text/plain`）：被拒绝，返回 `HTTP 403`（`CSRF_CONTENT_TYPE_REQUIRED`）。
- 非法身份名 `nonexistent-hacker`：被服务端白名单拒绝，返回 `HTTP 400`。

### 3.4 多组织身份与 RBAC 鉴权隔离验证
- 切换为 `cell-viewer`：查询电池健康接口返回 `health.allowed === false`；审计接口返回 `auditorRoleActive === false`。
- 切换为 `lab-inspector`：查询电池健康接口返回 `health.allowed === true`；读取加密报告 `a4-rep-8fb7b0e6` 明文成功（`HTTP 200`）。
- 切换为 `lab-auditor`：审计接口返回 `auditorRoleActive === true` 且实时查出链上 `243` 个 `AuditBatch` 批次。

### 3.5 A1–A8 安全攻防实网验证（`POST /api/bff/lab/run` `{ attackId: "ALL" }`）
全部 8 项均返回 `blocked: true`、`stateUnchanged: true` 且 `beforeDigest === afterDigest`：
- **A1**：`HTTP 201` | `FORBIDDEN` | 拦截层：`PEER_ENDORSEMENT_REJECTED` | `submitted: false`
- **A2**：`HTTP 201` | `QUALITY_GATE` | 拦截层：`CHAINCODE_REJECTED` | `submitted: false`
- **A3**：`HTTP 400` | `REPORT_HASH_MISMATCH` | 拦截层：`API_INTEGRITY_REJECTED` | `submitted: false`
- **A4**：`HTTP 201` | `FORBIDDEN` | 拦截层：`CHAINCODE_REJECTED` | `submitted: false`
- **A5**：`HTTP 201` | `FORBIDDEN` | 拦截层：`CHAINCODE_REJECTED` | `submitted: false`
- **A6**：`HTTP 409` | `POLICY_PREVIEW_REQUIRED` | 拦截层：`API_POLICY_GATE_REJECTED` | `submitted: false`
- **A7**：`HTTP 400` | `CODE_FORMAT / CODE_CHEMISTRY` | 拦截层：`CHAINCODE_QUERY_REJECTED` | `submitted: false`
- **A8**：`HTTP 201` | `FORBIDDEN` | 拦截层：`CHAINCODE_REJECTED` | `submitted: false`

---

## 4. 浏览器可视化与响应式巡检证据

- 由浏览器子代理实测访问 `http://127.0.0.1:3100`（主机事实 `BROWSER_HOST_FACTS` 确认 `visited_origins: http://127.0.0.1:3100`、`blocked_origins: none`），覆盖桌面端 `1440×900` 与移动端 `390×844` 全 11 个页面。
- 首次巡检截图发现移动端顶栏 `OrgBadge` 折行及 `/identity` 24 位输入框文字挤压裁切问题，随即在 `Badges.tsx`、`AppShell.tsx`、`identity/page.tsx` 修复并重建重启 `:3100` 服务，二次复检截图（`final_step_69.png`）已直接目视确认顶栏单行紧凑呈现与布局对齐正常。
