# 本地 Fabric 环境

业务网络使用 `batterybusiness` / `battery` 1.4 和四个业务 MSP。
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

## 独立审计演示

现有服务器的 `AuditOrgMSP` 已从配置区块 597 加入原 `batterybusiness` 通道。独立 Peer 持久化同步账本，`trustguard-audit.service` 使用专用系统身份和服务专属凭证签署后续锚定。服务器项目根目录可只读执行 `.venv/bin/python -B infrastructure/scripts/server_audit_peer.py block --number 598`，以独立审计身份读取并与原业务 Peer 比对。首次回执及四组织审批规则核对结果见[服务器独立审计验收](../docs/reports/server-audit-org-20261118.json)。

在项目 WSL 根目录执行。已有四组织业务运行资料提供公开 MSP 与排序节点证书。首次 `.venv/bin/python infrastructure/scripts/audit_peer_demo.py init` 在专属 `infrastructure/runtime/audit-peer-demo/` 下创建审计 CA、Peer、管理员、审计员与五组织创世块，只允许首次生成。

`.venv/bin/python infrastructure/scripts/audit_peer_demo.py verify` 临时启动回环地址上的 Fabric Peer，使用端口 25051、25052、25444。首次执行将创世块加入独立 Peer 的本地账本，后续执行复用该账本并追加节点日志。审计客户端读回第 0 块，与原始区块头和配置交易逐项比较，随后停止本次进程。业务通道为 `batterybusiness`，独立演示通道为 `batteryauditdemo`。

只读检查可使用 `sha256sum infrastructure/runtime/audit-peer-demo/genesis.block` 和 `node services/api/scripts/verify-audit-signer.mjs`。后者需要已编译的 API，校验独立签名身份及 CA 隔离。候选版审计 worker 使用 `TRUSTGUARD_AUDIT_SIGNER_MSP` 指定独立客户端 MSP 的绝对路径，使用 `TRUSTGUARD_AUDIT_VERIFY_KEY_FILE` 指定网关日志签名公钥文件。独立签名凭证仅供 worker 读取。实际锚定业务通道还需要该通道已接纳 AuditOrgMSP 并启用支持它的链码。
