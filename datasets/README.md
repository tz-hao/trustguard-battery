# 仿真数据

生成器：`services/risk/trustguard_risk/datasets.py`，种子 20261115。
共 20 批次 × 40 条记录（涵盖 `LFP` 磷酸铁锂与 `TERNARY` 三元材料两类电化学体系，含显著阶跃故障与耦合漂移离群样本）；前 15 批训练（600 条）、后 5 批测试（200 条），无批次交叉。
全部记录标记 `simulation: true`，并包含工程单位、型号、条件与来源摘要。
模型评估报告见 `docs/reports/risk-simulation-evaluation.json`，同时保留固定阈值规则基线对照，不代表真实产业准确率。
业务演示另通过带来源签名的 CSV 导入。无真实企业、仪器或车辆数据。
