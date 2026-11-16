# 智权链·锂安溯

动力电池可信溯源与主动安全防护平台。已实现 Go 业务链码、NestJS mTLS API、FastAPI 风控、
加密报告与独立密钥服务、可重建索引、策略预演、审计摘要锚定及 Next.js 11 页面安全工作台（`apps/web`，18 个服务端 mTLS BFF 路由）。
四组织 **local** Fabric 网络已运行，链码 `battery` 版本 `1.3` / sequence `4`，通道 `batterybusiness`。
数据均为显式模拟；已依据用户补充的标准正文和第 1 号修改单核验 24 位新产品字段与日期规则，正式厂商登记关闭。

```text
apps/web          Next.js / React 11 页面前端与服务端 mTLS BFF（127.0.0.1:3100）
services/api      NestJS / Fabric Gateway / 文件、索引、审计、总览与验收脚本
services/risk     FastAPI / Isolation Forest / 规则与签名数据适配器
chaincode         Go 业务规则、Fabric 入口及测试
infrastructure    隔离四组织网络、证书及进程管理脚本
datasets          仿真数据说明（固定种子生成器在风险服务内）
tests             环境检查
docs/design       前端视觉设计系统与 11 页面规格文档
docs/reports      各阶段证据与配置报告
```

Node.js `22.23.1`，npm `10.9.8`，Go `1.26.4`，Fabric `2.5.16`。
官方示例单独安装在 `/home/milli/projects/fabric-samples`，未复制进业务源码。

```bash
cd /home/milli/projects/trustguard-battery
source infrastructure/scripts/env.sh
source .venv/bin/activate
npm run check:env
```

环境依赖已通过根 `package-lock.json` 固定。新装 Node 依赖使用 `npm ci`，
不要替换当前 Hermes 共享 Node。Web 前端可通过 `npm run check:types --workspace @trustguard/web`、
`npm run build --workspace @trustguard/web` 构建验证，并由 `business_services.py start --service web` 在 `http://127.0.0.1:3100` 启动。

后端启动、接口与验收见 [后端使用说明](docs/backend.md)，进度见 [实施记录](docs/implementation.md)，
编码规则、依据与范围见 [标准核验记录](docs/standards-gbt34014.md)。
原示例网络运行说明仍见 [infrastructure/README.md](infrastructure/README.md)，其账本保留。
原环境配置证据见 [环境配置报告](docs/reports/environment-setup-2026-11-15.md)。

仅按授权部署并验证本地测试网络；没有 Git 提交、推送、PR、远程部署或公链操作。`.gitignore` 排除工具、虚拟环境、依赖、
测试身份与密钥；业务目录尚未执行 `git init`。
