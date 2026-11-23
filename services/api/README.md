# API 后端

使用 Node.js 22.23.1 和官方 Fabric Gateway SDK。
提供 NestJS mTLS API、Fabric Gateway 交易/复核、加密报告、索引及审计 worker。
构建：`npm run build --workspace @trustguard/api`；本地启动和验收见 [后端说明](../../docs/backend.md)。

原示例验收脚本仍只读外部示例身份。业务使用被忽略的独立 runtime 身份，不把证书/密钥放入源码。

DeepSeek 后端接口已接入（默认关闭）：配置示例 `deepseek-settings.example.json`，使用说明 [docs/deepseek-api.md](../../docs/deepseek-api.md)。
`npm test` 包含离线供应商协议、权限、持久化幂等与 HTTP 路由验收；真实模型调用需另行配置密钥。