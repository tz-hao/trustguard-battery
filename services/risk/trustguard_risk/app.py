import os
from contextlib import asynccontextmanager
from pathlib import Path

from cryptography.hazmat.primitives.serialization import load_pem_private_key
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException

from .attestation import issue_attestation
from .models import AttestationRequest, OperationRequest, QualityRequest, CsvImportRequest,SignedHealthRequest
from .operations import analyze_operations
from .quality import QualityAnalyzer


@asynccontextmanager
async def lifespan(app: FastAPI):
    path = os.environ.get("TRUSTGUARD_RISK_KEY_FILE")
    if not path:
        raise RuntimeError("TRUSTGUARD_RISK_KEY_FILE required; no generated fallback signer")
    key = load_pem_private_key(Path(path).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("risk signer must be Ed25519")
    app.state.signer = key
    app.state.signer_id = os.environ.get("TRUSTGUARD_RISK_SIGNER_ID", "risk-v1")
    analyzer = QualityAnalyzer()
    reference = os.environ.get("TRUSTGUARD_REFERENCE_FILE")
    if reference:
        import json
        from .models import Measurement
        records = [Measurement.model_validate(row) for row in json.loads(Path(reference).read_text())]
        analyzer.fit(records)
    app.state.quality = analyzer
    app.state.sources = {}
    sources_file = os.environ.get("TRUSTGUARD_SOURCE_KEYS_FILE")
    if sources_file:
        import json, base64
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        app.state.sources = {name: Ed25519PublicKey.from_public_bytes(base64.b64decode(value,validate=True))
                             for name,value in json.loads(Path(sources_file).read_text()).items()}
    yield


app = FastAPI(title="TrustGuard internal risk service", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "qualityModelGroups": len(app.state.quality.models)}


@app.post("/readiness")
def readiness():
    if not app.state.quality.models:
        raise HTTPException(503,"quality reference model unavailable")
    return {"ready":True}


@app.post("/quality/analyze")
def quality(request: QualityRequest):
    return {"results": [app.state.quality.analyze(row) for row in request.measurements]}


@app.post("/operations/analyze")
def operations(request: OperationRequest):
    try:
        return analyze_operations(request)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@app.post("/attestations")
def attestations(request: AttestationRequest):
    # Internal endpoint: serving must require the dedicated Gateway workload client certificate.
    # The public API must construct this input from trusted ledger/feature state, never forward user risk flags.
    if not app.state.quality.models:
        raise HTTPException(503, "quality reference model unavailable; automatic release paused")
    return issue_attestation(request, app.state.signer, app.state.signer_id)


@app.post("/ingestion/csv")
def ingest_csv(request: CsvImportRequest):
    import base64
    from .ingestion import import_csv
    if not app.state.sources:
        raise HTTPException(503, "trusted source registry unavailable")
    try:
        content = base64.b64decode(request.contentBase64, validate=True)
        return import_csv(content,request.sourceId,request.batchId,request.issuedAt,request.signature,app.state.sources)
    except Exception:
        raise HTTPException(422,"source signature or CSV contract invalid") from None


@app.post("/ingestion/health")
def ingest_health(request:SignedHealthRequest):
    from .ingestion import verify_health
    try:return verify_health(request,app.state.sources)
    except Exception:raise HTTPException(422,"health signature or measurement invalid") from None
