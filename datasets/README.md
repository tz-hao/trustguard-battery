# 仿真数据

生成器：`services/risk/trustguard_risk/datasets.py`，种子 20261115。
共 20 批次 × 40 条记录；前 15 批训练、后 5 批测试，分别 600/200 条，无批次交叉。
全部记录标记 simulation，并包含工程单位、型号、条件与来源摘要。
模型报告见 `docs/reports/risk-simulation-evaluation.json`，同时保留规则基线，不代表真实产业准确率。
业务演示另通过带来源签名的 CSV 导入。无真实企业、仪器或车辆数据。
