# DeepSeek 后端接入

## 公网工作台（2026-11-18）

服务器档案页提供“问 AI · 查看风险依据”。查询模拟电池后，有权限的业务身份可生成风险解释或输入证据问题。点击回答中的依据编号可查看记录 ID，链上资产及质检记录还会显示交易 ID。“读取已保存结果”按当前身份和资产回读最近一条分析，刷新页面也可回读。公网演示使用共享身份，请仅输入模拟业务问题。

全站每天最多预约 10 次新分析，按北京时间零点起算。所有演示身份共用额度。已发起的失败请求也占用一次预约；同一身份重放同一请求及读取已有结果均不重复计数。模型输出用于人工复核，已过期的风险凭证会显示历史标记。

服务器现有配置由 API 进程读取。只读检查可打开公网 `/api/bff/ai` 查看配置状态，或在档案页点“读取已保存结果”。需要更换凭据时，在服务器的 SSH 终端以管理员运行下列两步。第一步隐藏输入，写入或替换 root 专用的 `/etc/trustguard-deepseek/api.key`。第二步写入或替换 API 单元的 `40-deepseek.conf`，重载 systemd 并重启 API。模型真实验收会消耗额度，写入分析结果和审计记录；原有审计服务会将摘要追加到服务器私有链。

```bash
sudo python3 /opt/trustguard-deploy/ai-archive-20261118/configure_server_deepseek.py store
sudo python3 /opt/trustguard-deploy/ai-archive-20261118/configure_server_deepseek.py activate
```

若原配置已通过环境变量设置密钥，应由服务器管理员在其原配置源轮换或移除旧值；环境变量优先于凭据文件。以下“当前交付”和离线验收记录描述早期仅后端接入的阶段。

## 当前交付

2026-11-18 按用户选择接入 DeepSeek。用户确认尚未配置密钥，先完成代码与离线验收。
提供风险解释和针对单资产/当前 PACK 组件的证据问答；结果仅用于人工复核，不签风险凭证，不执行放行、账本写入或寿命预测。
现有风险模型、链码和前端未改动。当前仓库已有前端及其他未提交改动，本次没有覆盖它们。

官方协议依据：[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。
固定发送到 `https://api.deepseek.com/chat/completions`；默认 `deepseek-flash`，模型名可通过配置修改，需使用支持该协议/JSON 模式的模型。
请求为非流式、关闭 thinking、`response_format:json_object`，随后在本地用 Zod 严格校验输出。空白、截断、错误字段、未知证据编号均拒绝。

## 启用配置

**未设置时 AI 默认关闭**，现有 API 能继续启动；启用但无密钥返回 `AI_NOT_CONFIGURED`。
状态接口中的 `available` 只表示配置已满足，`connectivityVerified:false` 明确表示未做远程探测。

现有 `business_services.py` 仅为 API 进程加载私有文件：

```text
infrastructure/runtime/business/ai-environment.json
```

可从 `services/api/deepseek-settings.example.json` 复制并修改，内容如下（路径必须替换为本机实际私有文件）：

```json
{
  "TRUSTGUARD_AI_ENABLED": "true",
  "DEEPSEEK_MODEL": "deepseek-flash",
  "DEEPSEEK_API_KEY_FILE": "<repo-root>/infrastructure/runtime/business/services/deepseek.key",
  "TRUSTGUARD_AI_TIMEOUT_MS": "30000",
  "TRUSTGUARD_AI_MAX_TOKENS": "2500",
  "TRUSTGUARD_AI_ALLOW_REAL_DATA": "false"
}
```

将密钥单独写入上述 `deepseek.key`，只含密钥本身，文件权限设为 `600`。不要把密钥放在聊天、命令行参数或前端变量中。
私有配置只允许示例中的字符串键；禁止覆盖数据库/TLS 等配置。已有 `.gitignore` 忽略运行目录和 `*.key`。
也支持在 API 进程环境中设置 `DEEPSEEK_API_KEY`，其优先级高于文件；不自动加载 `.env`。
本次没有创建实际密钥或启用运行配置。

配置完成且本地依赖已运行后：

```bash
cd <repo-root>
npm run build --workspace @trustguard/api
.venv/bin/python infrastructure/scripts/business_services.py restart --service api
```

API 启动时沿用既有迁移机制应用 `004_ai_analyses.sql`。本次本机 API/数据库/Fabric 端口不可达，未重启服务、未在真实 PostgreSQL 应用迁移。

## 接口

均在既有 mTLS 认证之后。

| 方法及路径 | 用途 |
| --- | --- |
| `GET /api/v1/ai/status` | 不访问模型，返回配置状态与支持的任务 |
| `POST /api/v1/ai/analyses` | 创建分析，或通过相同 requestId 获取原结果 |
| `GET /api/v1/ai/analyses/{requestId}` | 查询本人结果，重新核验资产权限并检查快照/策略是否变化 |

风险解释请求：

```json
{
  "requestId": "risk-explain-001",
  "assetId": "替换为实际有权访问的资产ID",
  "task": "risk_explanation"
}
```

证据问答请求：

```json
{
  "requestId": "trace-question-001",
  "assetId": "替换为实际有权访问的资产ID",
  "task": "trace_question",
  "question": "目前有哪些证据说明这个电池包需要进一步复核？"
}
```

`trace_question` 必须有 1—1000 字的问题；`risk_explanation` 不接受 question。禁止客户端传入身份、模型、证据或上游 URL。
自由文本问题会发送给 DeepSeek，请勿包含凭证和未经授权的敏感内容；程序拒绝常见密钥格式，但这不是完整敏感信息识别器。

成功响应形状（以下是说明示例，不是实际模型结果）：

```json
{
  "requestId": "risk-explain-001",
  "assetId": "pack-example",
  "state": "completed",
  "completed": true,
  "advisoryOnly": true,
  "errorCode": null,
  "stale": false,
  "result": {
    "provider": "deepseek",
    "model": "deepseek-flash",
    "task": "risk_explanation",
    "analysis": {
      "summary": {"text": "需要补充检测证据后再复核。", "evidenceIds": ["E1"]},
      "findings": [],
      "reviewSuggestions": [],
      "unknowns": ["未提供足够检测记录"]
    },
    "references": [{"evidenceId": "E1", "kind": "asset", "resourceId": "pack-example", "txId": "账本交易ID"}],
    "humanReviewRequired": true,
    "citationValidation": "REFERENCE_IDS_EXIST_ONLY",
    "remainingLifeEstimate": null,
    "plannedScrapAt": null
  }
}
```

实际 `result` 还带有生成时间、promptVersion、允许查看的证据快照、evidenceHash、snapshotHash、policyVersion 和 token 用量（供应商未返回则为 null）。
证据引用校验仅保证引用编号存在，不能保证模型陈述在语义上被证据支持；模型输出必须经人工复核。

## 权限、数据与成本

- 允许角色：manufacturer/operator/custodian/inspector/auditor/approver/release；同时必须是资产当前持有组织。LabOrg 仅 inspector/auditor 可跨持有方查看。
- 历史结果绑定请求者 actorHash；其他身份不能查询。查询和幂等重放重新检查当前持有权，资产转移后旧持有人不能继续读取。
- 默认只允许显式模拟数据。真实数据外发必须经业务授权后单独配置 `TRUSTGUARD_AI_ALLOW_REAL_DATA:true`，不能把该开关当作获得企业数据授权。
- 出站证据只包含白名单字段：材料、状态、质量、版本、日期、匿名组件关系和已有风险摘要。真实资产 ID、编码、厂商名、型号、交易哈希、报告明文、签名和凭证不进入自动证据提示词。问题文本由调用者负责避免主动包含这些信息。
- 当前只读取目标资产和 PACK 的当前组件快照、当前策略版本以及该资产最近一条已有风险记录。不运行新的数值检测、不创建风险凭证。无风险记录时显式标记缺失；旧快照/过期凭证显式标为 stale。
- 同一 actorHash/requestId 只预约一次上游请求；不同载荷复用 ID 返回 409。成功、失败、处理中都可以查询。
- 超过 2 分钟仍 running 的历史请求展示 interrupted；不自动重新调用。确认需要再次生成时使用新 requestId，可能产生新费用。
- PostgreSQL 短事务/全局 advisory lock 控制最近 2 分钟的全局在途量为 2，每身份每分钟最多 5 个新请求。没有自动重试；429/超时不会隐式重复计费。
- 默认总请求超时 30 秒（可配置 1—60 秒），最大输出 2500 tokens（256—4096），输入 48 KB、上游响应 128 KB、组件 100 个上限；超限返回明确错误，不静默裁剪。
- 发送前及生成后重新核验持有权、快照与策略；发生变化则拒绝结果。证据读取和外部调用不是分布式原子操作，仍需遵守数据外发授权。
- 审计仅写身份摘要、请求 ID、结果码和证据摘要，不记录提示词、密钥或供应商错误正文。分析表保存经结构校验后的建议和证据，权限检查在服务端执行。

主要错误：`AI_DISABLED`/`AI_NOT_CONFIGURED`/`AI_CONFIGURATION_INVALID`（503）；`FORBIDDEN`/`AI_REAL_DATA_DISABLED`（403）；
`IDEMPOTENCY_CONFLICT`/`AI_EVIDENCE_CHANGED`（409）；`AI_RATE_LIMITED`/`AI_PROVIDER_RATE_LIMITED`（429）；`AI_TIMEOUT`（504）；
`AI_INVALID_OUTPUT`/`AI_UNKNOWN_EVIDENCE`（502）。失败后的同 ID 重放返回持久化失败状态，检查 `completed`，不要仅依赖 HTTP 201。

## 验证

```bash
npm test --workspace @trustguard/api
.venv/bin/python -m pytest tests/test_ai_config.py -q
```

本次：25 项 Node 测试（含实际 NestJS 临时 HTTP 监听、路由、幂等重放与 OpenAPI 检查），6 项 Python 配置测试通过。
模型传输、Fabric 和数据库使用**显式离线测试替身**；没有在生产代码中增加 Mock 模式。
真实 PostgreSQL 迁移/并发锁、真实 mTLS + Fabric + DeepSeek 全链路以及模型回答质量尚未验证。

服务启用后可先只检查配置。以下 Python 包装仅加载本项目私有连接环境，不打印配置内容：

```bash
.venv/bin/python - <<'PY'
import sys, subprocess
sys.path.insert(0, 'infrastructure/scripts')
from business_services import environment
from toolchain import resolve_node
subprocess.run([resolve_node(), 'services/api/scripts/verify-ai.mjs'], env=environment(), check=True)
PY
```

明确授权真实调用且配置好密钥后，给脚本增加 `--live --asset <有权访问的模拟资产ID> --identity pack-operator`。
此模式调用一次 DeepSeek、保存建议并核验重放与引用；会产生 API 费用，不发送 Fabric 交易。实际回答正确性仍需人工检查。

本轮没有开发 PDF/OCR 检测报告提取、全库自由检索、跨批次召回 Agent、自动决策或前端调用页面；这些不属于本次后端模型接入接口。
验收记录：[DeepSeek 离线接入验收](reports/deepseek-integration-2026-11-18.json)。
