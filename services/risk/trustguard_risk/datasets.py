"""Explicitly simulated multi-chemistry measurements, split by batch before training/evaluation."""
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score

from .models import Measurement
from .quality import QualityAnalyzer


def _chemistry_for_batch(batch: int) -> str:
    if batch < 15:
        return "LFP" if batch < 8 else "TERNARY"
    return "LFP" if batch < 18 else "TERNARY"


def generate(seed: int = 20261115) -> tuple[list[Measurement], list[Measurement], list[int]]:
    rng = np.random.default_rng(seed)
    training, testing, labels = [], [], []
    for batch in range(20):
        chemistry = _chemistry_for_batch(batch)
        means = [3000, 1500, 3300, 25] if chemistry == "LFP" else [3250, 1300, 3700, 25]
        stds = [35, 45, 10, 1] if chemistry == "LFP" else [35, 40, 12, 1]
        for sample in range(40):
            anomaly = batch >= 15 and sample % 8 == 0
            capacity, resistance, voltage, temperature = rng.normal(means, stds)
            if anomaly:
                if sample % 16 == 0:
                    # Obvious step fault
                    capacity -= 480
                    resistance += 560
                else:
                    # Correlated multivariate drift staying near/within naive single-threshold bands
                    capacity -= 145 if chemistry == "LFP" else 160
                    resistance += 185 if chemistry == "LFP" else 195
                    voltage -= 65 if chemistry == "LFP" else 80
                    temperature += 3.8
            record = Measurement(
                asset_id=f"sim-cell-{batch}-{sample}",
                batch_id=f"sim-batch-{batch}",
                chemistry=chemistry,
                model="sim-3000",
                condition="25C-1C",
                capacity_mah=capacity,
                resistance_uohm=resistance,
                voltage_mv=voltage,
                temperature_c=temperature,
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
        "tp": int(tp),
        "fp": int(fp),
        "tn": int(tn),
        "fn": int(fn),
    }


def evaluate() -> dict:
    training, testing, labels = generate()
    analyzer = QualityAnalyzer()
    analyzer.fit(training)
    assert not analyzer.training_batches & {row.batch_id for row in testing}
    results = [analyzer.analyze(row) for row in testing]
    predictions = [int(result["reviewRequired"]) for result in results]
    # Static single-threshold baseline tuned for naive LFP/TERNARY step bounds without multivariate correlation.
    baseline = [int(row.capacity_mah < 2800 or row.resistance_uohm > 1800) for row in testing]

    by_chemistry = {}
    for chem in ("LFP", "TERNARY"):
        idx = [i for i, row in enumerate(testing) if row.chemistry == chem]
        by_chemistry[chem] = {
            "samples": len(idx),
            "model": metrics([labels[i] for i in idx], [predictions[i] for i in idx]),
            "ruleBaseline": metrics([labels[i] for i in idx], [baseline[i] for i in idx]),
        }

    return {
        "simulation": True,
        "seed": 20261115,
        "modelVersion": analyzer.version,
        "trainingSamples": len(training),
        "testSamples": len(testing),
        "batchOverlap": 0,
        "chemistries": ["LFP", "TERNARY"],
        "model": metrics(labels, predictions),
        "ruleBaseline": metrics(labels, baseline),
        "byChemistry": by_chemistry,
        "latencyP95Ms": float(np.percentile([result["latencyMs"] for result in results], 95)),
        "limitations": (
            "Synthetic held-out batches (LFP & TERNARY step faults + correlated drift) only; "
            "not evidence of industrial accuracy or safety certification."
        ),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(evaluate(), ensure_ascii=False, indent=2) + "\n")
    print("Simulation evaluation report written")
