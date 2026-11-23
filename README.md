# 智权链·锂安溯

动力电池可信溯源与主动安全防护平台。已实现 Go 业务链码、NestJS mTLS API、FastAPI 风控、
加密报告与独立密钥服务、可重建索引、策略预演、审计摘要锚定及 Next.js 11 页面安全工作台（`apps/web`，21 个服务端 mTLS BFF 路由）。
四组织 **local** Fabric 网络基于通道 `batterybusiness`，链码 `battery` 版本 `1.5` / sequence `6`。模拟 PACK 从创建到移交的四笔真实页面回执及数据保留结果见[本地 1.5 交接验收](docs/reports/v15-local-transfer-20261118.json)。
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

## V2.1 首版功能验收

扫码档案与字段证据在电池数字身份页，单电芯正向查询在谱系页，整批质检与独立复检在检测中心。数字身份页也提供 MES 示例文件和模拟站点冲突记录。逐项操作、判定条件和复跑命令见[六项功能验收说明](docs/reports/v21-local-acceptance.md)。2026-11-18 四组织本地网络完成升级，交易、数据保留和真实页面验收结果见[1.4 本地实测记录](docs/reports/v14-live-acceptance-20261118.json)。

服务器 1.4 策略激活、本地 1.5 四阶段交接及隔离审计 Peer 的验证结果见[创新点逐项验收记录](docs/reports/innovation-acceptance-20261118.md)。

## 日常启停与检查

以下命令从本地仓库根目录运行。查询四组织业务服务进程需要已初始化的本地环境。

| 目标 | 命令 | 结果与副作用 |
| --- | --- | --- |
| 四组织业务网络（只读） | `.venv/bin/python infrastructure/scripts/business_network.py status` | 列出正在运行的业务容器、状态和端口。 |
| 四组织业务服务（只读） | `.venv/bin/python infrastructure/scripts/business_services.py status` | 依据已记录的 PID 核对当前进程命名空间中可见的六项服务。 |
| 双组织示例容器（只读） | `infrastructure/scripts/docker-local.sh ps -a --filter label=com.docker.compose.project=trustguard-battery-fabric` | 列出该示例的容器，包括已停止的容器。 |
| 双组织示例账本（写入） | `npm run verify:fabric` | 成功时在 `trustguardchannel` 通道的 `basic` 链码上提交两笔交易，创建并转移一个新示例资产。报告写入 `docs/reports/phase4-transactions.json`，覆盖原有内容。 |

用以下命令检查本地工具与依赖版本。

```bash
source infrastructure/scripts/env.sh
source .venv/bin/activate
npm run check:env
```

完整启动或恢复本地环境。首次初始化会部署链码，默认写入演示数据。

```bash
.venv/bin/python infrastructure/scripts/bootstrap.py
```

也可分步恢复已有的四组织网络并启动业务服务。

```bash
.venv/bin/python infrastructure/scripts/business_network.py resume
.venv/bin/python infrastructure/scripts/business_services.py start
```

环境依赖已通过根 `package-lock.json` 与 `services/risk/requirements.lock` 固定。Web 前端可通过 `npm run check:types --workspace @trustguard/web`、`npm run build --workspace @trustguard/web` 构建验证，并由 `business_services.py start --service web` 在 `http://127.0.0.1:3100` 启动。

后端启动、接口与验收见 [后端使用说明](docs/backend.md)，进度见 [实施记录](docs/implementation.md)，
编码规则、依据与范围见 [标准核验记录](docs/standards-gbt34014.md)，本地网络管理说明见 [infrastructure/README.md](infrastructure/README.md)。
`.gitignore` 排除 `.tools/`、`.venv/`、`node_modules/` 及 `infrastructure/runtime/` 下的本地密钥与测试身份；仅运行本地测试网络，无远程部署或公链操作。
