"""A bounded, signed CSV adapter. Signature verification precedes parsing or persistence."""
import base64
import csv
import hashlib
import io
import json
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .models import Measurement,SignedHealthRequest

FIELDS = ["asset_id", "batch_id", "chemistry", "model", "condition", "capacity_mah", "resistance_uohm", "voltage_mv", "temperature_c", "simulation"]


def source_payload(source_id: str, batch_id: str, digest: str, issued_at: str) -> bytes:
    return json.dumps({"sourceId": source_id, "batchId": batch_id, "payloadHash": digest, "issuedAt": issued_at}, separators=(",", ":"), ensure_ascii=False).encode()


def import_csv(content: bytes, source_id: str, batch_id: str, issued_at: str, signature: str,
               sources: dict[str, Ed25519PublicKey], now: datetime | None = None) -> dict:
    if len(content) > 4 * 1024 * 1024:
        raise ValueError("CSV exceeds 4 MiB")
    if source_id not in sources:
        raise ValueError("untrusted source")
    issued = datetime.strptime(issued_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if issued > now or now - issued > timedelta(hours=24):
        raise ValueError("source signature interval expired")
    digest = hashlib.sha256(content).hexdigest()
    sources[source_id].verify(base64.b64decode(signature, validate=True), source_payload(source_id, batch_id, digest, issued_at))
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")), strict=True)
    if reader.fieldnames != FIELDS:
        raise ValueError("CSV headers or engineering units do not match the adapter contract")
    records, seen = [], set()
    for raw in reader:
        if len(records) >= 1000 or raw.get(None) is not None or any(value is None for value in raw.values()):
            raise ValueError("CSV row bound or column count exceeded")
        if raw["batch_id"] != batch_id or raw["asset_id"] in seen:
            raise ValueError("batch mismatch or duplicate asset")
        seen.add(raw["asset_id"])
        if raw["simulation"] not in ("true", "false"):
            raise ValueError("explicit simulation boolean required")
        values = {key: value if value != "" else None for key, value in raw.items()}
        values["simulation"] = raw["simulation"] == "true"
        values["source_hash"] = digest
        records.append(Measurement.model_validate(values))
    if not records:
        raise ValueError("CSV is empty")
    return {"sourceId": source_id, "batchId": batch_id, "sourceHash": digest,
            "issuedAt": issued_at, "measurements": [row.model_dump() for row in records]}


def verify_health(request:SignedHealthRequest,sources:dict[str,Ed25519PublicKey],now:datetime|None=None)->dict:
    if request.sourceId not in sources:raise ValueError("untrusted health source")
    measured=datetime.strptime(request.measuredAt,"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if measured>(now or datetime.now(timezone.utc)):raise ValueError("future health measurement")
    value=request.model_dump(exclude={"signature"})
    payload=json.dumps(value,separators=(",",":"),ensure_ascii=False).encode()
    sources[request.sourceId].verify(base64.b64decode(request.signature,validate=True),payload)
    return {**value,"sourceHash":hashlib.sha256(payload).hexdigest()}
