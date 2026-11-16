import base64
import json
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import ValidationError

from trustguard_risk.attestation import issue_attestation
from trustguard_risk.datasets import generate, evaluate
from trustguard_risk.models import AttestationRequest, Operation, OperationRequest
from trustguard_risk.operations import analyze_operations
from trustguard_risk.quality import QualityAnalyzer


def test_batch_split_has_no_leakage_and_detects_outliers():
    train, test, labels = generate()
    assert not {r.batch_id for r in train} & {r.batch_id for r in test}
    analyzer = QualityAnalyzer()
    analyzer.fit(train)
    anomalies = [row for row, label in zip(test, labels) if label]
    assert all(analyzer.analyze(row)["reviewRequired"] for row in anomalies)
    assert all(analyzer.analyze(row)["qualityConclusion"] is None for row in anomalies)


def test_missing_data_and_unknown_group_require_review():
    row = generate()[0][0]
    analyzer = QualityAnalyzer()
    missing = row.model_copy(update={"capacity_mah": None})
    assert "MISSING_MEASUREMENT" in analyzer.analyze(missing)["triggeredRules"]
    assert "NO_MATCHING_REFERENCE_MODEL" in analyzer.analyze(row)["triggeredRules"]


def test_cannot_fit_too_small_reference_set():
    with pytest.raises(ValueError):
        QualityAnalyzer().fit(generate()[0][:10])


def test_input_rejects_non_finite_values_and_unknown_fields():
    row = generate()[0][0].model_dump()
    for bad in [float("nan"), float("inf"), -1]:
        with pytest.raises(ValidationError):
            type(generate()[0][0]).model_validate({**row, "capacity_mah": bad})
    with pytest.raises(ValidationError):
        type(generate()[0][0]).model_validate({**row, "riskScore": 0})


def test_cyclic_fast_approvals_trigger_review_not_guilt():
    now = datetime.now(timezone.utc)
    events = [Operation(actor_msp=a, target_msp=b, action="ApproveRelease", at=now, approval_latency_seconds=1)
              for a, b in [("CellOrgMSP", "PackOrgMSP"), ("PackOrgMSP", "CellOrgMSP")] * 3]
    result = analyze_operations(OperationRequest(operations=events, as_of=now))
    assert result["reviewRequired"]
    assert {r["rule"] for r in result["triggeredRules"]} >= {"CYCLIC_APPROVAL_RELATIONSHIP", "FAST_APPROVAL_CLUSTER"}
    assert result["conclusion"] == "REQUIRES_REVIEW"


def test_future_operations_are_rejected():
    now = datetime.now(timezone.utc)
    event = Operation(actor_msp="CellOrgMSP", action="test", at=now + timedelta(seconds=1))
    with pytest.raises(ValueError):
        analyze_operations(OperationRequest(operations=[event], as_of=now))


def test_attestation_signature_and_binding():
    private = Ed25519PrivateKey.generate()
    request = AttestationRequest(requestId="release-1", assetId="pack-1", snapshotHash="a"*64,
                                 policyVersion=1, quality_review_required=True,
                                 operation_review_required=False, evidenceHash="b"*64)
    now = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
    risk = issue_attestation(request, private, "risk-v1", now)
    assert risk["level"] == "HIGH"
    signature = base64.b64decode(risk["signature"])
    risk["signature"] = ""
    private.public_key().verify(signature, json.dumps(risk, separators=(",", ":"), ensure_ascii=False).encode())
    assert risk["requestId"] == "release-1"
    assert risk["expiresAt"] == "2026-11-15T12:05:00Z"


def test_evaluation_reports_real_sample_counts_and_limitations():
    report = evaluate()
    assert report["simulation"] is True
    assert report["trainingSamples"] == 600
    assert report["testSamples"] == 200
    assert report["batchOverlap"] == 0
    assert report["model"]["recall"] >= .9
    assert report["latencyP95Ms"] > 0
