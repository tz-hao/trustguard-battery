# 本地 Fabric 环境

业务网络现已独立实现，当前使用 `batterybusiness` / `battery` 1.3、四个业务 MSP。
恢复、启动与验证见 [后端说明](../docs/backend.md)。以下保留可选双组织官方 `test-network` 示例环境的说明，不应把 basic 示例当作业务链码。

Fabric CLI 与配置由 `./infrastructure/scripts/setup.sh` 自动安装至 `.tools/fabric`（或通过环境变量 `FABRIC_SAMPLES` 指向外部 `fabric-samples` 目录）。
Go 与本地工具默认安装在业务项目 `.tools`，不修改全局 PATH、Node、Python、代理。

```bash
source infrastructure/scripts/env.sh
go version
peer version
infrastructure/scripts/docker-local.sh ps
```

`docker-local.sh` 会优先调用本机 `docker`，并在 WSL2 原生集成不可用时自动回退至 Windows Docker CLI 的 `desktop-linux` Context（可通过 `TRUSTGUARD_DOCKER_BIN` 覆盖）。
Docker 镜像来自官方 `ghcr.io/hyperledger`，固定 2.5.16。

`start-fabric.py` 已执行，仅供全新环境一次初始化。它使用官方 Compose 定义，
将配置和测试身份通过本机内存流复制到本项目命名卷，替代不可用的 WSL bind mount。
文件复制不是同步挂载，修改源配置后不会自动改变卷内文件。
网络为 `trustguard_battery_fabric`，Compose 项目为 `trustguard-battery-fabric`。
配置卷 `cfg1` 至 `cfg5` 和三个账本卷均应保留；配置卷中包含本地测试密钥。
禁止上传这些卷、生成的身份目录和 `.tools` 到远程仓库。

现有容器停止后，仅恢复本项目已有容器：

```bash
python3 infrastructure/scripts/resume-fabric.py
```

该命令只执行 `compose start`，不会创建或删除卷、重新生成证书或重建网络。
本次未额外改变官方容器的重启策略，不保证 Docker Desktop 重启后自动恢复测试网络。

本机端口：Orderer 7050、Orderer 管理 7053、Org1 Peer/Gateway 7051、Org2 Peer/Gateway 9051；
运维端口 9443/9444/9445。全部绑定 `127.0.0.1`，启用了 TLS。

链码 `basic`，Channel `trustguardchannel`，版本 `1.0`，sequence `1`，
策略 `AND('Org1MSP.peer','Org2MSP.peer')`。

```bash
npm run verify:fabric
```

上面的验收命令会在**本机测试账本真实创建并转移一个新的示例资产**，使用唯一资产 ID。
它读取现有 User1 身份并在内存签名，不打印密钥；不自动重试写交易。
日志和报告明确区分 built、endorsed、submitted、committed、ledger-verified。
它会更新 `docs/reports/phase4-transactions.json`；如需保留旧验收记录，请先另存报告。

禁止在此环境运行 `network.sh down`、`restart`、`docker system prune` 或泛化的容器/卷清理命令。
官方 `network.sh` 某些分支包含隐式 `networkDown`，本次直接使用已检查的子脚本，未进入这些分支。
