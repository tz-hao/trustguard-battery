# 后端使用说明

## 当前范围

本地四组织：CellOrgMSP、PackOrgMSP、LabOrgMSP、RecycleOrgMSP；每组织一个 Peer，单 Raft Orderer。
2026-11-18 回读四个本地 Peer，通道 `batterybusiness` 的 `battery` 为 1.4、sequence 5。公网四个 Peer 为 1.4、sequence 2，业务策略为 v2。1.5 是本地候选包。
公网使用四家业务机构的审计身份。本地独立审计演示使用单独通道 `batteryauditdemo`。前端工作台位于 `apps/web`。参见[本轮验收与复验命令](reports/innovation-acceptance-20261118.md)。

已依据补充 PDF（含第 1 号修改单）核验 24 位新产品字段、10 类材料和日期字典。
`GET codes/{code}` 默认返回修改单规则下的 `CODE_FIELDS_VERIFIED`，携带标准版本、来源摘要、
30 年循环信息及企业可选 X8 规格位候选，不推断唯一生产年份。新登记还校验编码与 `manufacturedAt` 一致，
按来源生产日期选择修改单生效前后的材料/序列号规则。历史 provisional 记录仍按原账本查询。
所有资产/厂商仍标记 simulation；正式厂商登记关闭，无真实 MES、BMS 或全国平台连接。
企业分配/备案、梯级重新编码及实体标识不在此字段验收范围，不能宣称完全符合全部国标要求。
详细依据、例码和边界见 [标准核验记录](standards-gbt34014.md)。

## 使用当前环境

全新克隆仓库请先在项目根目录执行：

```bash
./infrastructure/scripts/setup.sh
.venv/bin/python infrastructure/scripts/bootstrap.py
```

若本机已初始化 `infrastructure/runtime/business/`，可通过以下方式恢复与查看状态：

```bash
source infrastructure/scripts/env.sh
source .venv/bin/activate
npm run check:env
npm run build --workspace @trustguard/api
npm run build --workspace @trustguard/web

# 恢复已有容器，保留卷、证书及账本
.venv/bin/python infrastructure/scripts/business_network.py resume
# 只启动尚未运行的本项目进程
.venv/bin/python infrastructure/scripts/business_services.py start
.venv/bin/python infrastructure/scripts/business_services.py status
```

`infrastructure/scripts/docker-local.sh` 默认优先使用系统 `docker`，在仅 Windows Docker Desktop 可达的 WSL2 环境下自动回退至 `docker.exe --context desktop-linux`（也可用 `TRUSTGUARD_DOCKER_BIN` 显式指定）。
脚本不更改默认 Docker Context，不包含清库或批量清理命令。
沙箱进程命名空间不一定能看到外部启动的 PID，`status` 会明确提示不可见；这不等于服务已停止。

`business_services.py start` 需要已初始化的本地运行目录 `infrastructure/runtime/business/`（由 `bootstrap.py` 或 `business_network.py prepare` 生成），不自动生成替代 Mock。
该目录中的环境文件、密钥、测试身份和 vault 不应上传、粘贴到聊天或提交。
API 必须使用映射的客户端证书；直接浏览器访问会被拒绝。OpenAPI JSON 位于 `/api/docs-json`，Swagger UI 未启用。

| 服务 | 仅本机端口 | 验证方式 |
| --- | --- | --- |
| API | HTTPS 13000 | 客户端证书 + `/api/v1/health` |
| 风险 | HTTPS 18000 | 专用 Gateway 工作负载证书 + `/health` |
| 密钥服务 | HTTPS 18001 | 专用客户端证书 + 签名、限时、单次 permit |
| PostgreSQL | 15432 | 独立项目数据库角色 |
| MinIO | HTTP 19000 | 私有桶；保存的文件为 AEAD 密文 |
| Orderer | TLS 17050 / 管理 17053 | 独立本地网络 |
| Cell / Pack / Lab / Recycle Peer | TLS 17051 / 19051 / 21051 / 23051 | 四组织 Gateway |

## 本地验收命令

以下命令会新增**模拟业务数据、本地交易、测试日志或隔离重建 schema**，不是只读健康检查。
`security` 还会暂停并恢复本项目 risk/broker 进程，撤销一张新生成的测试证书。

```bash
.venv/bin/python infrastructure/scripts/business_services.py verify --check policy
.venv/bin/python infrastructure/scripts/business_services.py verify --check demo
.venv/bin/python infrastructure/scripts/business_services.py verify --check health
.venv/bin/python infrastructure/scripts/business_services.py verify --check security
.venv/bin/python infrastructure/scripts/business_services.py verify --check concurrency
.venv/bin/python infrastructure/scripts/business_services.py verify --check corrections
.venv/bin/python infrastructure/scripts/business_services.py verify --check index
.venv/bin/python infrastructure/scripts/business_services.py verify --check audit
.venv/bin/python infrastructure/scripts/business_services.py verify --check idempotency
.venv/bin/python infrastructure/scripts/business_services.py verify --check codes
```

`demo` 创建未装配、使用中、已报废三个样例，执行 A1—A8 安全用例；成功写入均检查 VALID、
区块数据哈希、背书、四 Peer 请求凭证和受影响资产状态。`corrections` 验证更正、四 Peer 历史与完整拆解。
`index` 使用新 schema，不清空现有索引；`audit` 检查签名、批次摘要和实际账本写集。
`idempotency` 检查已发布策略预演的重放，以及带 requestId 的报告撤权不重复修改原时间。
`codes` 检查标准例码、材料表、日期循环、修改单边界、新登记日期一致性与历史读取，并新增一个模拟电池包。
每轮报告保存在 `docs/reports/`，失败报告也保留，不应拿旧 PASS 代替新代码验收。

```bash
npm test --workspace @trustguard/api
cd chaincode
go test ./...
go vet ./...
cd ..
PYTHONPATH=services/risk .venv/bin/python -m pytest services/risk/tests tests/test_business_config.py -q
PYTHONPATH=services/risk .venv/bin/python -m trustguard_risk.datasets --report docs/reports/risk-simulation-evaluation.json
```

无有效 Git 元数据时，直接 `go build` 可在该次命令设置 `GOFLAGS=-buildvcs=false`；部署脚本已做此处理。
不修改共享 Node，Node/npm、Go、Python 版本沿用项目固定环境；Node 使用根 `package-lock.json`，
Python 使用 `services/risk/requirements.lock`。Go 已提供 vendor 以供本地链码离线构建。

## API 约定

所有接口均要求 mTLS。组织和角色来自证书绑定，不能通过 body/header 自报。
业务命令通用格式：

```json
{
  "requestId": "每次业务意图的唯一ID，重试复用",
  "data": { "id": "具体领域对象ID" }
}
```

`POST /api/v1/commands/{resource}` 的 data 字段与 Go `domain` 输入结构一致。
同一身份、同一 requestId 不会重发；不同载荷复用 ID 返回冲突。提交不确定时使用
`GET /api/v1/transactions/{requestId}` 复核，不能用新 ID 盲目重试。
响应需检查 `completed` 和 `stage`，不能仅凭 HTTP 状态或 txId 判断完成。
阶段区分 built、endorsed、submitted、committed、ledger-verified、rejected、invalid、unknown。

| 接口/命令 resource | 用途与主要角色 |
| --- | --- |
| `GET codes/{code}`、`makers/{code}`、`batteries/{code}` | 编码、厂商与最小档案 |
| `GET batteries/{code}/lifecycle`、`/health` | 生命周期；健康数据另检查角色和当前持有方 |
| `GET assets/{id}`、`/history`、`/corrections`、`/inspections`、`/assembly-history`、`/snapshot` | 当前状态、最近 200 条链上历史及证据 |
| `GET trace/batch/{id}` | 当前及时间区间重叠的历史影响 PACK，带索引高度和 stale 标记 |
| `makers`、`material-lots`、`batches`、`assets` | 本组织管理员/制造角色登记 |
| `assembly-authorizations`、`assembly` | Cell 制造方授权供料，Pack 装配角色建立/替换关系 |
| `inspections` | Lab inspector 签发；API 要求已验证上传的对应报告 |
| `POST release/requests` | Pack release 申请；body 为 requestId、id、packId，风险凭证由服务端生成 |
| `release-approvals`、`release-finalizations` | 独立组织批准与最终放行 |
| `transfer-drafts`、`transfer-dispatches` | 1.5 候选。当前持有机构的 custodian 创建、发出交接单，创建时登记收件方、凭证 SHA-256、有效期并锁定资产版本 |
| `transfer-acceptances`、`transfer-commits`、`transfer-cancellations` | 1.5 候选。接收方用所收凭证摘要签收，提交时核对持有方、版本及期限。草稿由转出方撤销，发出或签收后任一参与方可取消 |
| `GET transfers/{id}`、`GET overview/transfers` | 1.5 候选。分别读取链上交接单与工作台索引，按步骤返回已有交易 ID |
| `transfers`、`transfer-confirmations` | 兼容原 HTTP 客户端。1.5 候选内部依次完成创建与发出、签收与提交。历史 1.4 已发出单可按原规则完成 |
| `installations`、`first-use`、`retirements` | 有权限的当前持有方登记业务事件 |
| `recycling-receipts`、`scrap-confirmations` | Recycle 回收角色确认；预计日期不能代替实际报废 |
| `lifecycle-corrections`、`lifecycle-correction-approvals`、`lifecycle-correction-applications` | 提议、独立审核、应用更正 |
| `POST policies/previews`、`GET policies/current` | 隔离回归及当前策略 |
| `policy-candidates`、`policy-approvals`、`policy-activations` | 预演通过后四组织审核发布 |
| `POST reports`、`GET reports/{id}/content`、`POST reports/{id}/revocations` | 加密报告、受控解密下载、后续下载撤权 |
| `POST imports/measurements`、`imports/health` | 签名 CSV 与健康快照导入，Lab inspector |

除上表带完整前缀的接口外，命令 resource 位于 `POST /api/v1/commands/{resource}`。
公开操作示例与签名实现可直接参考 `services/api/scripts/demo-business.mjs`、`verify-health.mjs`、`verify-corrections.mjs`。

## 业务与安全边界

- 常规放行需 Cell/Lab/Pack 批准，高风险增加 Recycle；AI 不能降低权限或把异常直接判定为质量不合格。
- 风控服务不可用时 API 暂停新放行及最终放行；已签凭证受链码的请求、版本、签名和有效期检查约束。
- 装配仅在未放行且父级未绑定时编辑；空 children 表示完整拆解，历史边保留。换件使父级质量进入待复核。
- 更正仅适用于已有 installedAt/firstUseAt/retiredAt/scrappedAt，不能制造、清空事件或改变生命周期状态。
  制造方、当前持有方与独立 Lab 的 auditor 按不同 MSP 审核；申请绑定资产/策略版本，24 小时有效。
- 子资产可展示所属 PACK 的状态上下文，但不会把 PACK 的首次投用日期冒充电芯自己的使用年限。
- 健康快照使用整数 basis points（10000=100%）和循环次数，保留测量时间与签名来源。
  没有经过验证的寿命模型，remainingLifeEstimate/plannedScrapAt 始终为 null；设计寿命不等于剩余寿命。
- 原始报告不写公共账本。AES-GCM 绑定报告 ID/资产/版本/哈希；API 和独立 broker 都检查授权，broker 只读必要数据库列。
  撤权阻止后续获取，不能收回已合法下载的明文。开发进程同属本机用户，不宣称生产级 OS/HSM 隔离。
- 新安全日志签名绑定时间（v2）；早期 v1 日志保留版本标签。摘要批次在发送前冻结，结果不确定时按原 txId 复核。
- 模型只用固定种子仿真样本，批次不跨训练/测试集；评价结果不代表工业认证，规则基线和误报率均保留。

首次部署及升级需显式调用 `business_network.py deploy --version ... --sequence ...`，不会随启动自动升级链码。
已有运行目录不得重新执行 prepare/up 重建。恢复仅用 resume/start；没有提供 down/reset/prune 路径。
旧示例 `trustguardchannel` 与早期开发通道 `batterychannel` 均保留，当前业务不使用它们。

## DeepSeek 辅助分析接口（2026-11-18）

新增 `GET /api/v1/ai/status`、`POST /api/v1/ai/analyses`、`GET /api/v1/ai/analyses/{requestId}`。
支持证据驱动的风险解释与当前单资产/组件问答；保持人工复核，不能触发放行或链上写入。
默认关闭，缺少密钥时明确不可用，无 Mock 回退。配置、请求示例、权限和验证边界见 [DeepSeek 接入说明](deepseek-api.md)。
