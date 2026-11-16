# 后端实施与验收记录

依据：用户提供的《完整参赛项目方案 V2.1》及本对话确认的完整后端实施计划。
用户确认：不实现前端；允许新增独立四组织 local Fabric 网络、部署业务链码及执行本地测试交易；保留现有网络和其他服务。

## 交付追踪

| 能力 | 状态 | 验收依据 |
| --- | --- | --- |
| 编码、档案与生命周期 | 已补充标准正文及修改单的 24 位新产品规则；正式登记关闭 | `code-standard-verification.json`，含来源日期一致性和历史兼容 |
| 谱系、质检、审批、交接链码 | 已部署 1.3 / sequence 4；保留历史本地验收 | `business-chaincode-deployment-1.3.json`、Go 测试；原 MVCC 报告对应 1.2 |
| 四组织网络与角色证书 | local 运行中，证书有效期/撤销检查通过 | `security-verification-security-7921fe1b.json` |
| NestJS API、认证与幂等交易 | 最终演示 43 笔交易完成四 Peer 账本核验 | `business-demo-demo-bc010168.json` |
| PostgreSQL 索引与断点恢复 | 18 个资产断点、重建、回滚与并发去重通过 | `index-verification-rebuild_ee8144a99a55.json` |
| 加密对象存储与独立密钥服务 | 篡改、API/broker 撤权和服务中断测试通过 | 最终业务演示、安全报告、运行权限检查 |
| FastAPI、模型、规则、签名凭证 | 已运行；签名健康导入与权限测试通过 | `health-verification-health-b6a72bc4.json`、模型报告及 Python 测试 |
| 策略预演、审批与激活 | 规则源码匹配部署包，四组织激活策略 v3 | `policy-verification-policy-check-03762935.json` |
| 完整演示、安全测试与性能报告 | A1—A8 全部阻断；顺序本地交易 P95 约 1.09 秒 | `business-demo-demo-bc010168.json`，不代表生产吞吐 |
| 受控日期更正、历史与完整拆解 | 独立审核、终态不恢复、四 Peer 历史一致 | `correction-verification-correction-8860cecf.json` |
| 签名安全日志与周期摘要锚定 | 552 条日志/3 批摘要完整核验；周期 worker 运行 | `audit-verification.json`；随后运行快照为 554 条/4 批，无待锚定日志 |

## 已确定的实现约定

- Fabric 是关键状态与授权的权威来源；数据库只是可重建索引。
- 证书角色为 `trustguard.role`，请求参数不能指定调用者身份。
- 正常放行需要 CellOrg、LabOrg、PackOrg；高风险增加 RecycleOrg 审核。业务审批与 Peer 背书分开。
- 所有写操作包含幂等 requestId；相同身份、相同请求返回原结果，载荷不同拒绝。
- 时间使用 UTC RFC3339；日历年限展示采用 Asia/Shanghai。链码使用提案时间，不调用系统时钟。
- 原始文档不得公开上链；链上只保存哈希与不含敏感数据的证据引用。
- 数据均需来源标记，模拟码不能冒充正式企业编码。未知健康度和剩余寿命返回 null。

## 标准核验（2026-11-16 已补充）

此前用户确认暂缓全文核验；现已提供含第 1 号修改单的 PDF，已恢复并完成本项目 24 位新产品入口所需的正文核验。
文件已存档并记录 SHA-256，材料表、日期表和修改条款按页面图像核对，详见 [标准核验记录](standards-gbt34014.md)。

官方标准元数据已核验为 GB/T 34014—2017（现行），第 1 号修改单自 2026-08-01 实施。
当前实现覆盖 10 类材料、30 年日期循环、修改单字母数字序列号、可选 X8 规格位候选及新登记日期一致性。
正式厂商登记仍关闭，不能以获得标准代替真实厂商分配/资质/备案验证；梯级重新编码及实体标识不在本次交付范围。
不宣称完整标准符合性，旧 provisional 账本不迁移或覆盖。

来源：
- https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=60E981B01DE41613119F9C788AE3EAE4
- https://std.samr.gov.cn/gb/search/gbDetailedCNF?id=3B33CCA4D7FDAEEBE06397BE0A0AFC50

## 环境边界

当前环境 Docker 需通过受审查权限调用 Windows Docker CLI。只读检查已确认既有 Org1/Org2 网络和 chainmon-postgres 运行。
没有授权重启 WSL、调整全局代理、删除已有卷、远程部署或操作任何公链。

## 实施中发现并修复的事项

- 初始新建开发通道 `batterychannel` 的 Orderer Writers 规则不包含 orderer 身份，Peer 无法接收后续区块。保留该通道和所有原账本，使用修正规则后的 `batterybusiness`；原示例 `trustguardchannel` 不变。
- 换件会使父级质检进入 `REVIEW_REQUIRED`，装车/首次投用重新检查组件最新质量；对应 Go 回归从失败变为通过，并已更新链码 1.1。
- Fabric MSP 默认不以客户端证书有效期作为业务签发条件，因此链码入口另按提案时间检查证书有效区间。真实过期签发测试已通过。
- API 依赖中最初新增的 MinIO Node SDK 带入漏洞依赖，已替换为官方 S3 SDK，替换后的安装审计为 0。没有升级既有前端依赖。
- MinIO 使用官方固定安全修复源码 `RELEASE.2025-10-15T17-29-55Z` 构建静态二进制和本地镜像。社区仓库已归档，本配置仅用于开发，不声明生产维护保障。
- 当前目录无有效 Git 元数据，链码打包仅对该进程设置 `-buildvcs=false`；版本、sequence、包 ID 和规则源码摘要仍单独验证。

## 上一轮验证（链码 1.2，2026-11-16）

环境检查、API 构建及 6 项 Node 子测试、13 项 Python/基础设施测试、Go 单元/属性测试与 vet 均通过。
环境检查在默认沙箱遇到子进程 EPERM，已在平台受审查权限下成功执行；未为此修改业务逻辑或全局配置。
OpenAPI 已从实际 mTLS 服务取回，包含 23 个路由；前端未构建，未进行浏览器验收。

最终汇总见 `docs/reports/backend-acceptance-2026-11-16.json`。
既有容器、卷、镜像、Hermes/代理 PID 及共享 Node 保持原状，见 `backend-preservation-2026-11-16.json`。
旧失败报告保留用于追溯；本节与原汇总均为 1.2 快照，新标准规则以以下补充验证为准。

## 标准补充验证（链码 1.3，2026-11-16）

25 项 Go 测试（含 1000 组生成式编码字段还原）及 vet、API 构建和 7 项 Node 子测试通过。
链码 1.3 / sequence 4 已在本地四组织部署，各 Peer 定义核验一致；规则源码与实际部署包逐文件比较通过。
实际 API 已核验标准例码、10 类材料、日期/闰日/30 年循环、修改单边界、原始日期不匹配拒绝及历史模拟档案读取。
新增模拟钠离子电池包完成 VALID、四 Peer 请求凭证和资产状态核验；正式厂商登记仍被拒绝。
证据：[编码规则验收](reports/code-standard-verification.json)、[部署记录](reports/business-chaincode-deployment-1.3.json)。
1.3 完整模拟业务回归完成 42 笔四 Peer 核验交易，A1—A8 全部阻断，三种查询状态通过。
原容器、卷、镜像、示例网络、Hermes/代理 PID 和共享 Node 的只读保留检查通过。
最新汇总：[标准补充验收](reports/code-standard-supplement-2026-11-16.json)。
