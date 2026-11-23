# V2.1 创新点补齐与验收 · 2026-11-18

## 服务器策略

在原有 `batterybusiness` 通道、`battery` 1.4、sequence 2 上完成业务策略 v1 → v2。候选 `v14-window540-20261118` 将新放行单的审批窗口从 600 秒收紧至 540 秒。风险凭证仍为 300 秒，常规放行需三家组织，高风险需四家。变更前两笔 v1 待放行申请均已过期。变更后仍可读出原来的 36 个资产、6 笔放行单及两笔过期的 v1 记录。

| 验收 | 回读结果 |
| --- | --- |
| 部署包与预演 | 包 `battery_1.4:e2ad9692780cbd06c06bfec58c89e980042ac029f99af8e8cf4a728a34b17b48`，已核验规则源码，29 项 Go 用例通过 |
| 报告与签名 | 重算报告 SHA-256 并验证 Ed25519 签名，摘要 `d408069c6508bacaea18f6d96ee87f488e194ce545f7b5f558ac84f4bdc4bc70` |
| 业务提案 | `cell-admin`，区块 567 |
| 四家批准 | Cell、Pack、Lab、Recycle 的 auditor 分别在区块 568、569、570、571 完成 |
| 激活 | 区块 572，交易 `79fe75f7b48f1e204a2d78d4e0fc6cc8d30ed55743d424809c8d8834f0caf5ef` |
| 最终状态 | 分别查询四个 Peer，均为 ACTIVE、v2、540 秒、四家批准，预演摘要一致 |
| 原账本数据 | 解码区块 567–572 的六笔有效策略交易。业务链码只写入候选、审批审计、请求回执、生效策略和策略历史，激活时更新策略键的背书元数据。删除键数为 0，资产和放行单写入数均为 0 |

公网只读复验可打开策略页，查看“当前激活策略”、放行审批窗口、候选 ID、四家批准记录及 29 项回归明细。服务器侧栏仍有旧版静态链码标签，本地候选前端已改为读取仪表盘返回的部署版本。公网策略页 `/policies`

## 本地四阶段交接

| 动作 | 验收结果 |
| --- | --- |
| Pack 保管员创建、发出 | 分别得到 CREATED、SENT 两笔记录，持有方仍为 Pack |
| Cell 保管员签收 | 错误凭证摘要得到 FORBIDDEN，交接单仍为 SENT。正确摘要进入 ACCEPTED，刷新后持有方仍为 Pack、版本 7 |
| Cell 保管员提交 | 进入 COMMITTED，刷新后持有方为 Cell、版本 8，四步交易标识互异 |
| 取消、过期、版本变化 | 草稿、已发出及已签收单均可依规则取消，过期或资产版本有变化时提交被拦截，取消后可创建下一单 |
| 历史兼容 | Go 测试读取真实 1.4 字段布局的 SENT 夹具并完成签收。原 HTTP 双请求客户端在新单上得到四步记录，重复相同请求返回原回执 |

浏览器实际经过 Next.js 页面、BFF、隔离 mTLS 客户端、业务命令控制器及 Go 规则。持久性检查在同一进程内的隔离账本执行，刷新后重新读回。只有服务器策略验收使用正在运行的业务链交易。四个现有本地业务 Peer 均读回 1.4、sequence 5。

1.5 本地候选包为 `infrastructure/runtime/chaincode-candidates/battery_1.5.tar.gz`。Fabric 包 ID 为 `battery_1.5:8ba65cf4185efc168725db781133c6a3f78b241f29c654d1de0fc3d86e794f10`，包内 16 个项目源码、测试和模块文件与本地逐字节一致。

## 本地独立审计

在隔离通道 `batteryauditdemo` 中实际启动了独立 Fabric Peer。创世配置包含四家业务 MSP 和 `AuditOrgMSP`。审计员以独立 CA 签发的证书读取区块 0，区块头和配置交易与原块一致。复用账本重启后高度仍为 1。原始创世块 SHA-256 为 `a52bddd4e8b2e46c3b378e8abce43b5e6c240be18e8d8593a2d8121f253d05c4`。

演示配置的业务背书、生命周期背书和应用管理员策略仅计四家业务组织，门槛为三家。链码测试验证独立审计员可以锚定并认领自己的日志证据，业务审批与交接命令会被拒绝。worker 的独立签名身份通过本地校验，误配成业务组织 CA 会停止。现有服务器仍由四家业务组织参与，外部机构持有密钥并实际运营节点需要单独接入。

## 本地复验

本次通过 33 项 Go 顶层测试、28 项 API 测试、4 项基础设施配置测试及 2 项浏览器流程测试。Go 静态检查、受影响页面的 ESLint 检查、API 与前端构建均通过。

在项目 WSL 根目录使用 Node 22.23.1、npm 10.9.8、项目 Go 1.26.4 和 Fabric 2.5.16。以下命令仅操作本地构建产物、测试缓存、临时证书、隔离账本和浏览器报告。浏览器测试临时证书位于 WSL 临时目录，策略测试会在 `infrastructure/runtime/business/verified-rules/` 缓存按包和样例摘要校验的源码。每次运行使用新的浏览器输出目录。

```bash
source infrastructure/scripts/env.sh
(cd chaincode && go test -count=1 ./... && go vet ./...)
npm test --workspace @trustguard/api
npm run build --workspace @trustguard/web
(cd apps/web && ../../node_modules/.bin/playwright test tests/transfer-workflow.spec.mjs tests/policy-window.spec.mjs --output="$(mktemp -d)" --reporter=line)
```

策略页隔离用例从本地保存的已部署 1.4 包运行规则，额外绑定四份公开 MES 样例的摘要。管理员输入 540 秒后可看到 600 → 540 的差异，刷新后可以继续提议。测试替换内存中的报告签名后，审批前校验返回 `POLICY_PREVIEW_EVIDENCE_INVALID`。

现有独立演示目录可直接复验。第一条命令只读，第二条读取独立账本并追加本地 Peer 日志。首次生成与目录说明见[基础设施说明](../../infrastructure/README.md)。

```bash
node services/api/scripts/verify-audit-signer.mjs
.venv/bin/python infrastructure/scripts/audit_peer_demo.py verify
```

只读检查本地候选包和 1.4 部署包证明可分别执行以下命令。

```bash
peer lifecycle chaincode calculatepackageid infrastructure/runtime/chaincode-candidates/battery_1.5.tar.gz
.venv/bin/python infrastructure/scripts/verify_rule_source.py --version 1.4 --sequence 5 --package-proof
```
