"""Run the audit worker with unit-scoped credentials and a dedicated OS identity."""
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[2]
creds = Path(os.environ["CREDENTIALS_DIRECTORY"])
runtime = Path(os.environ["RUNTIME_DIRECTORY"])
orgs = json.loads((creds / "public-gateways").read_text())
for org in orgs:
    name = org["mspId"]
    org["certificateFile"] = str(creds / (name + "-cert"))
    org["gatewayTlsRootFile"] = str(creds / (name + "-tls"))
    org["privateKeyFile"] = "/dev/null"  # Only the independent signer can sign.
registry = runtime / "gateways.json"
registry.write_text(json.dumps(orgs))
msp = runtime / "msp"
for relative, credential in [("signcerts/cert.pem", "sign-cert"), ("keystore/key.pem", "sign-key"),
                             ("cacerts/ca.pem", "sign-ca")]:
    link = msp / relative
    link.parent.mkdir(mode=0o700, exist_ok=True, parents=True)
    if not link.exists():
        link.symlink_to(creds / credential)
    if link.resolve() != creds / credential:
        raise RuntimeError("Unexpected audit credential binding")
env = {**os.environ, "TRUSTGUARD_DATABASE_URL": (creds / "database-url").read_text().strip(),
       "TRUSTGUARD_IDENTITIES_FILE": str(registry), "TRUSTGUARD_AUDIT_SIGNER_MSP": str(msp),
       "TRUSTGUARD_AUDIT_VERIFY_KEY_FILE": str(creds / "log-public"),
       "TRUSTGUARD_CHANNEL": "batterybusiness", "TRUSTGUARD_CHAINCODE": "battery"}
node = root / ".tools/node/bin/node"
os.execve(node, [str(node), str(root / "services/api/dist/audit-worker.js")], env)
