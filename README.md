# 智权链·锂安溯

动力电池可信溯源与主动安全防护平台。已实现 Go 业务链码、NestJS mTLS API、FastAPI 风控、
加密报告与独立密钥服务、可重建索引、策略预演、审计摘要锚定及 Next.js 11 页面安全工作台（`apps/web`，21 个服务端 mTLS BFF 路由）。
四组织 **local** Fabric 网络基于通道 `batterybusiness`，链码 `battery` 版本 `1.3` / sequence `4`。
数据均为显式模拟；已依据标准正文和第 1 号修改单核验 24 位新产品字段与日期规则，正式厂商登记关闭。

```text
apps/web          Next.js / React 11 页面前端与服务端 mTLS BFF（127.0.0.1:3100）
services/api      NestJS / Fabric Gateway / 文件、索引、审计、总览与验收/消融脚本
services/risk     FastAPI / Isolation Forest / NetworkX / 规则与签名数据适配器
chaincode         Go 业务规则、Fabric 入口及离线 vendor
infrastructure    隔离四组织网络、证书、环境安装、赛前就绪检查与进程管理脚本
datasets          仿真数据说明（LFP + TERNARY 多体系与漂移生成器在风险服务内）
tests             环境、配置、并发压测与 k6 脚本（tests/perf/）
docs/design       前端视觉设计系统与 11 页面规格文档
docs/reports      各阶段证据、消融对照、并发压测与验收报告
```

## 快速开始（Fork / 全新环境从零启动）

前置依赖：**Docker（含 Compose）**、**Node.js 22.x**（推荐 `22.23.1`）、**Python 3.12**。支持 Linux、macOS 与 WSL2。

```bash
git clone <your-fork-url>
cd trustguard-battery

# 1. 自动安装本地工具链（Go 1.26.4、Fabric 2.5.16 CLI/配置）、Python .venv、npm 依赖并构建前后端
./infrastructure/scripts/setup.sh

# 2. 一键初始化本地四组织 Fabric 网络、PostgreSQL、MinIO、部署链码并启动全部 6 个服务（含初始化演示数据）
.venv/bin/python infrastructure/scripts/bootstrap.py
```

启动完成后访问工作台：`http://127.0.0.1:3100`（若需跳过初始化演示数据，可加 `--no-demo`）。

> 若本机已有独立安装的 `fabric-samples`，可先设置 `export FABRIC_SAMPLES=/path/to/fabric-samples`；否则 `setup.sh` 会自动下载官方 Fabric 2.5.16 CLI 与配置到 `.tools/fabric`。若不想本地编译 MinIO 静态镜像，可设置 `TRUSTGUARD_MINIO_IMAGE` 指定兼容镜像。

## 日常启停与检查

```bash
source infrastructure/scripts/env.sh
source .venv/bin/activate
npm run check:env

# 恢复已有容器并启动本地服务（若已初始化，bootstrap.py 也会自动走安全恢复流程）
.venv/bin/python infrastructure/scripts/bootstrap.py
# 或分步管理：
.venv/bin/python infrastructure/scripts/business_network.py resume
.venv/bin/python infrastructure/scripts/business_services.py start
.venv/bin/python infrastructure/scripts/business_services.py status
```

环境依赖已通过根 `package-lock.json` 与 `services/risk/requirements.lock` 固定。Web 前端可通过 `npm run check:types --workspace @trustguard/web`、`npm run build --workspace @trustguard/web` 构建验证，并由 `business_services.py start --service web` 在 `http://127.0.0.1:3100` 启动。

后端启动、接口与验收见 [后端使用说明](docs/backend.md)，进度见 [实施记录](docs/implementation.md)，
编码规则、依据与范围见 [标准核验记录](docs/standards-gbt34014.md)，本地网络管理说明见 [infrastructure/README.md](infrastructure/README.md)。
`.gitignore` 排除 `.tools/`、`.venv/`、`node_modules/` 及 `infrastructure/runtime/` 下的本地密钥与测试身份；仅运行本地测试网络，无远程部署或公链操作。
