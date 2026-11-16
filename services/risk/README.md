# 风险服务开发环境

项目根目录 `.venv` 使用现有 Python 3.12.3 创建。
执行 `source .venv/bin/activate` 后开发，依赖固定在 `requirements.lock`。
包含 FastAPI、质量 Isolation Forest/规则、审批关系分析、Ed25519 凭证和签名 CSV/健康适配器。
通过 `python -m trustguard_risk.server` 启动时强制 mTLS；缺少签名密钥或参考数据时不回退到演示评分。
运行与评价命令见 [后端说明](../../docs/backend.md)。
