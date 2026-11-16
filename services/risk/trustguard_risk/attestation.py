import base64
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .models import AttestationRequest


def issue_attestation(
    request: AttestationRequest, private_key: Ed25519PrivateKey, signer_id: str,
    now: datetime | None = None,
) -> dict:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    # Insertion order is the Go Risk struct order. Empty signature is included in signed bytes.
    risk = {
        "id": "risk-" + uuid4().hex,
        "requestId": request.requestId,
        "assetId": request.assetId,
        "snapshotHash": request.snapshotHash,
        "policyVersion": request.policyVersion,
        "modelVersion": "quality-operation-v1",
        "level": "HIGH" if request.quality_review_required or request.operation_review_required else "LOW",
        "evidenceHash": request.evidenceHash,
        "issuedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": (now + timedelta(seconds=request.ttl_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signerId": signer_id,
        "signature": "",
    }
    payload = json.dumps(risk, separators=(",", ":"), ensure_ascii=False).encode()
    risk["signature"] = base64.b64encode(private_key.sign(payload)).decode()
    return risk
