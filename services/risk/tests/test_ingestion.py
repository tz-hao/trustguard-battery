import base64
import hashlib
from datetime import datetime, timezone

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from trustguard_risk.ingestion import FIELDS, import_csv, source_payload
from trustguard_risk.ingestion import verify_health
from trustguard_risk.models import SignedHealthRequest


def fixture():
    content = (",".join(FIELDS)+"\ncell-1,batch-1,LFP,sim-3000,25C-1C,3000,1500,3300,25,true\n").encode()
    private = Ed25519PrivateKey.generate()
    issued = "2026-11-15T12:00:00Z"
    signature = base64.b64encode(private.sign(source_payload("lab-source", "batch-1", hashlib.sha256(content).hexdigest(), issued))).decode()
    return content, private, issued, signature


def test_signed_csv_preserves_units_missing_values_and_provenance():
    content, private, issued, signature = fixture()
    result = import_csv(content,"lab-source","batch-1",issued,signature,{"lab-source":private.public_key()},datetime(2026,11,15,13,tzinfo=timezone.utc))
    assert result["measurements"][0]["capacity_mah"] == 3000
    assert result["measurements"][0]["simulation"] is True
    assert result["measurements"][0]["source_hash"] == hashlib.sha256(content).hexdigest()


def test_source_tampering_or_replay_outside_interval_is_rejected():
    content, private, issued, signature = fixture()
    with pytest.raises(InvalidSignature):
        import_csv(content.replace(b"3000,1500",b"3100,1500"),"lab-source","batch-1",issued,signature,{"lab-source":private.public_key()},datetime(2026,11,15,13,tzinfo=timezone.utc))
    with pytest.raises(ValueError):
        import_csv(content,"lab-source","batch-1",issued,signature,{"lab-source":private.public_key()},datetime(2026,11,17,13,tzinfo=timezone.utc))


def test_signed_health_rejects_tampering_and_future_measurement():
    import json
    private=Ed25519PrivateKey.generate()
    value={"sourceId":"lab-source","id":"health-1","assetId":"pack-1","measuredAt":"2026-11-15T12:00:00Z","sohBasisPoints":9820,"cycleCount":100,"simulation":True}
    signature=base64.b64encode(private.sign(json.dumps(value,separators=(",",":")).encode())).decode()
    request=SignedHealthRequest(**value,signature=signature)
    verified=verify_health(request,{"lab-source":private.public_key()},datetime(2026,11,15,13,tzinfo=timezone.utc))
    assert verified["sohBasisPoints"]==9820
    with pytest.raises(InvalidSignature):verify_health(request.model_copy(update={"cycleCount":0}),{"lab-source":private.public_key()},datetime(2026,11,15,13,tzinfo=timezone.utc))
    with pytest.raises(ValueError):verify_health(request,{"lab-source":private.public_key()},datetime(2026,11,14,13,tzinfo=timezone.utc))
