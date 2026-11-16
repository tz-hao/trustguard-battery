# 智权链·锂安溯（TrustGuard Battery）前端最终验收报告

## 1. 验收结论与交付物清单

`apps/web` 已按现代工业科技与企业级能源 SaaS 标准完成全面重构与第二阶段全栈完善，升级为 **6 大业务域、11 个独立页面、21 个 Next.js BFF 路由**，并保留全部既有后端连接（Fabric 2.5.16 四组织网络、Go 链码 `battery v1.3 / sequence 4`、NestJS mTLS API、FastAPI 风控、MinIO 加密存储与独立密钥服务）。

**核心文档交付物：**
- 设计系统规范：`docs/design/frontend-design-system.md`
- 11 页面功能规格：`docs/design/frontend-page-specification.md`
- 重构与完善实施报告：`docs/reports/frontend-redesign-report.md`
- 最终验收报告（本文档）：`docs/reports/frontend-final-acceptance.md`
- 多体系 AI / 消融 / 并发报告：`docs/reports/risk-simulation-evaluation.json`、`docs/reports/ablation-comparison.json`、`docs/reports/concurrency-benchmark.json`
- 同步更新的使用说明：`apps/web/README.md`、`README.md`

---

## 2. 编译、安全与后端基线测试结果

所有检查均在最终代码修改及重启 `http://127.0.0.1:3100` 服务后实测完成：

| 验收项目 | 执行命令 / 范围 | 实际结果 | 备注 |
| --- | --- | --- | --- |
| ESLint 静态代码检查 | `npm run lint --workspace @trustguard/web` | 通过（0 错误、0 警告） | ESLint 9 + `eslint-config-next` |
| TypeScript 类型检查 | `npm run check:types --workspace @trustguard/web` | 通过（0 错误） | 覆盖全部 11 页面与 21 BFF 路由 |
| Next.js 生产构建 | `npm run build --workspace @trustguard/web` | 通过（30/30 静态页，退出码 0） | Next.js 16.4.6 Turbopack（11 页面 + 21 BFF 路由） |
| npm 依赖安全审计 | `npm audit` | 通过（`found 0 vulnerabilities`） | 通过精准 `minimatch` override 消除传递漏洞 |
| Playwright 端到端回归 | `npm run test:e2e --workspace @trustguard/web` | 7/7 通过（16.6s） | 覆盖 1440×900 全 11 页 + 390×844 移动端、编码防错、CSV 抽屉、DAG 缩放装配、NetworkX 环路、Lab A1 实网拒绝及审计联动 |
| 赛前只读就绪巡检 | `.venv/bin/python infrastructure/scripts/contest_ready.py` | 通过（11 路由 HTTP 200） | Fabric 高度 `#292` / PG `#291` / 策略 `v3`，资产总量 `32`（电芯 `13`、模组 `10`、PACK `9`） |
| 源码密钥泄漏扫描 | 扫描工作区新增与修改文件 | 通过 | 无 `NEXT_PUBLIC_*` 或硬编码私钥，证书仅在 `server/api-client.ts` 读取 |
| 环境工具链检查 | `npm run check:env` | 通过（`PASS`） | Node 22.x/Go/Python 3.12/Fabric 2.5 CLI/Next/Gateway SDK 齐备 |
| Go 链码测试与审查 | `go test -count=1 ./... && go vet ./...` | 通过（`ok`） | `trustguard/battery` `0.003s`、`domain` `0.027s` |
| 后端 API 单元测试 | `npm test --workspace @trustguard/api` | 7/7 通过（0 失败，716.15ms） | AEAD 加解密、Key Permit、服役年限、终态及错误映射 |
| Python 风控与配置测试 | `PYTHONPATH=services/risk .venv/bin/pytest services/risk/tests tests/test_business_config.py -q` | 15/15 通过（4.31s） | LFP/TERNARY 多体系评估、签名源解析及业务配置校验 |
| 基线资源保留检查 | `.venv/bin/python infrastructure/scripts/check-preservation.py` | 通过（`PASS`） | 原有容器、镜像、卷与 Hermes/Node 环境完整保留 |

---

## 3. 全站 11 页面、BFF、CSRF、RBAC 与 A1–A8 实网测试结果

测试脚本在重建并重启 `127.0.0.1:3100` 生产服务后执行，全部断言零跳过通过：

### 3.1 11 个页面路由可达性（均返回 HTTP 200）
- `/`、`/identity`、`/inspections`、`/trace`、`/approvals`、`/transfers`、`/risk`、`/policies`、`/lab`、`/audit`、`/organizations` 全部返回 `HTTP 200`，SSR 页面标记完整且无 `Application error`。

### 3.2 BFF 数据链路核验
- 共 13 项 GET 请求全部 `HTTP 200`：`/api/bff/session`（返回 28 组白名单身份且无 `privateKey`/`certPath`/`keyPath` 字段泄漏）、`dashboard`、`assets`、`batches`、`inspections`、`transfers`、`releases`、`risk`（加载 `quality-iforest-v1` 评估指标 `f1=0.8333333333333334`）、`audit`、`battery?code=DMAPB010000001E114616111`、`trace?batchId=lab-a4-1c77e1ff-batch`、`reports/a4-rep-8fb7b0e6/content`、`transactions/audit-4904-4906-c1778103d0f9`。

### 3.3 CSRF 与白名单边界验证
- 伪造跨域 `Origin: https://evil.example` 请求 `POST /api/bff/session`：被拒绝，返回 `HTTP 403`（`CSRF_ORIGIN_MISMATCH`）。
- 非 `application/json` 请求体（`text/plain`）：被拒绝，返回 `HTTP 403`（`CSRF_CONTENT_TYPE_REQUIRED`）。
- 非法身份名 `nonexistent-hacker`：被服务端白名单拒绝，返回 `HTTP 400`。

### 3.4 多组织身份与 RBAC 鉴权隔离验证
- 切换为 `cell-viewer`：查询电池健康接口返回 `health.allowed === false`；审计接口返回 `auditorRoleActive === false`。
- 切换为 `lab-inspector`：查询电池健康接口返回 `health.allowed === true`；读取加密报告 `a4-rep-8fb7b0e6` 明文成功（`HTTP 200`）。
- 切换为 `lab-auditor`：审计接口返回 `auditorRoleActive === true` 且实时查出链上 `273` 个 `AuditBatch` 批次。

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

## 4. 浏览器可视化与 Playwright E2E 验证

- **Playwright 自动化巡检**：使用无头 Chromium 在桌面端 `1440×900`（全部 11 页）与移动端 `390×844`（5 核心页面）执行 `apps/web/tests/e2e.spec.ts` 全套 7 项端到端用例，全部通过且耗时 `16.6s`，无控制台错误、无页面未捕获异常、无横向溢出。
- **首轮视觉巡检修复记录**：此前通过浏览器代理巡检发现移动端顶栏 `OrgBadge` 折行及 `/identity` 24 位输入框文字挤压裁切问题，已在 `Badges.tsx`、`AppShell.tsx`、`identity/page.tsx` 修复并复核通过。

---

## 5. 多体系 AI 评估、基线消融与并发基准实测

- **LFP + TERNARY 跨批次多体系 AI 评估（`docs/reports/risk-simulation-evaluation.json`）**：固定种子 `20261115` 生成 `600` 训练集 + `200` 跨批次测试集（`batchOverlap: 0`）。`IsolationForest`（`quality-iforest-v1`）整体 `recall=1.0`、`precision=0.7143`、`f1=0.8333`、`falsePositiveRate=0.0571`、`latencyP95Ms=5.021ms`（`LFP` 120 样本 `f1=0.7692`，`TERNARY` 80 样本 `f1=0.9524`）；同期规则基线 `recall=0.64`、`f1=0.7805`（漏报 `9` 例联合漂移样本）。注：为显式仿真数据评估结果。
- **基线 A / 基线 B vs 实验 C 消融对照（`docs/reports/ablation-comparison.json`）**：7 项对抗与风险场景实测显示，单库无链模型 Baseline A 阻断 `0 / 7`，无 AI 的纯链码对照 Baseline B 阻断 `5 / 7`（放行耦合漂移 `AI-Q` 与跨组织极速互批闭环 `AI-O`），完整智权链平台 Experiment C 阻断 `7 / 7`（`protectionRate=1`），且增加风控就绪检查后平均查询时延由 `26.17ms` 变为 `26.15ms`（`addedRiskOverheadMs=0`）。
- **单机并发吞吐与限流突刺基准（`docs/reports/concurrency-benchmark.json`）**：在 `c=20` 并发下，`/api/bff/assets` 达到 `280.67 rps`（`p95=77.02ms`）、`/api/bff/battery` 达到 `190.87 rps`（`p95=120.38ms`）、`/api/bff/dashboard` 达到 `139.44 rps`（`p95=178.56ms`）；突发 `135` 请求实测 `120` 笔放行、`15` 笔命中网关限流 `HTTP 429`、`0` 笔崩溃（`rps=374`、`p95=190.29ms`）。注：属单机开发环境实测基线，非跨主机生产吞吐证明。
