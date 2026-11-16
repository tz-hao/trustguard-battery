from __future__ import annotations

from collections import defaultdict
from time import perf_counter

import numpy as np
from sklearn.ensemble import IsolationForest

from .models import Measurement


class QualityAnalyzer:
    """Fit on authorized reference data only; never train during a query."""

    def __init__(self, version: str = "quality-iforest-v1") -> None:
        self.version = version
        self.models: dict[tuple[str, str, str], IsolationForest] = {}
        self.training_batches: set[str] = set()

    def fit(self, records: list[Measurement]) -> None:
        groups = defaultdict(list)
        for row in records:
            features = row.features()
            if features is not None:
                groups[row.group].append(features)
                self.training_batches.add(row.batch_id)
        fitted = {}
        for group, values in groups.items():
            if len(values) < 32:
                continue
            fitted[group] = IsolationForest(
                n_estimators=128, contamination=0.05, random_state=20261115, n_jobs=1
            ).fit(np.asarray(values))
        if not fitted:
            raise ValueError("at least 32 complete reference samples in one group required")
        self.models = fitted

    def analyze(self, row: Measurement) -> dict:
        start = perf_counter()
        reasons = []
        features = row.features()
        score = None
        if features is None:
            reasons.append("MISSING_MEASUREMENT")
        else:
            expected_voltage = (2000, 4000) if row.chemistry == "LFP" else (2500, 4500)
            if not expected_voltage[0] <= row.voltage_mv <= expected_voltage[1]:
                reasons.append("VOLTAGE_OUTSIDE_DEMO_RULE")
            if not 15 <= row.temperature_c <= 35:
                reasons.append("TEST_TEMPERATURE_OUTSIDE_REFERENCE")
            model = self.models.get(row.group)
            if model is None:
                reasons.append("NO_MATCHING_REFERENCE_MODEL")
            else:
                score = float(model.decision_function([features])[0])
                if score < 0:
                    reasons.append("STATISTICAL_OUTLIER")
        return {
            "assetId": row.asset_id,
            "reviewRequired": bool(reasons),
            "qualityConclusion": None,
            "triggeredRules": reasons,
            "anomalyScore": score,
            "modelVersion": self.version,
            "sourceHash": row.source_hash,
            "simulation": row.simulation,
            "latencyMs": (perf_counter() - start) * 1000,
        }
