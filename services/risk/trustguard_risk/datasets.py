"""Explicitly simulated measurements, split by batch before training/evaluation."""
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix

from .models import Measurement
from .quality import QualityAnalyzer


def generate(seed: int = 20261115) -> tuple[list[Measurement], list[Measurement], list[int]]:
    rng = np.random.default_rng(seed)
    training, testing, labels = [], [], []
    for batch in range(20):
        for sample in range(40):
            anomaly = batch >= 15 and sample % 8 == 0
            capacity, resistance, voltage, temperature = rng.normal(
                [3000, 1500, 3300, 25], [40, 50, 10, 1]
            )
            if anomaly:
                capacity -= 500
                resistance += 600
            record = Measurement(
                asset_id=f"sim-cell-{batch}-{sample}", batch_id=f"sim-batch-{batch}",
                chemistry="LFP", model="sim-3000", condition="25C-1C",
                capacity_mah=capacity, resistance_uohm=resistance,
                voltage_mv=voltage, temperature_c=temperature,
                source_hash=hashlib.sha256(f"simulated:{seed}:{batch}:{sample}".encode()).hexdigest(),
                simulation=True,
            )
            if batch < 15:
                training.append(record)
            else:
                testing.append(record)
                labels.append(int(anomaly))
    return training, testing, labels


def metrics(labels: list[int], predictions: list[int]) -> dict:
    tn, fp, fn, tp = confusion_matrix(labels, predictions, labels=[0, 1]).ravel()
    return {
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "falsePositiveRate": float(fp / (fp + tn)) if fp + tn else None,
        "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
    }


def evaluate() -> dict:
    training, testing, labels = generate()
    analyzer = QualityAnalyzer()
    analyzer.fit(training)
    assert not analyzer.training_batches & {row.batch_id for row in testing}
    results = [analyzer.analyze(row) for row in testing]
    predictions = [int(result["reviewRequired"]) for result in results]
    # This fixed rule baseline is specific to this simulated product and test condition.
    baseline = [int(row.capacity_mah < 2800 or row.resistance_uohm > 1800) for row in testing]
    return {
        "simulation": True, "seed": 20261115, "modelVersion": analyzer.version,
        "trainingSamples": len(training), "testSamples": len(testing),
        "batchOverlap": 0, "model": metrics(labels, predictions),
        "ruleBaseline": metrics(labels, baseline),
        "latencyP95Ms": float(np.percentile([result["latencyMs"] for result in results], 95)),
        "limitations": "Synthetic held-out batches only; not evidence of industrial accuracy or safety certification.",
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(evaluate(), ensure_ascii=False, indent=2) + "\n")
    print("Simulation evaluation report written")
