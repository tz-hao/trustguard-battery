"""Development-only independent CAs/MSPs. Keys never leave ignored runtime paths.

Uses the Fabric-supported X.509 format and standard Fabric certificate attribute OID.
No existing organization identity is read, copied, overwritten or regenerated.
"""
from __future__ import annotations

import ipaddress
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID, ObjectIdentifier

ORGANIZATIONS = {"cell": "CellOrgMSP", "pack": "PackOrgMSP", "lab": "LabOrgMSP", "recycle": "RecycleOrgMSP"}
ROLES = {
    "cell": ["admin", "manufacturer", "approver", "custodian", "operator", "auditor", "viewer"],
    "pack": ["admin", "manufacturer", "assembler", "release", "approver", "custodian", "operator", "auditor", "viewer"],
    "lab": ["admin", "inspector", "approver", "custodian", "auditor", "viewer"],
    "recycle": ["admin", "recycler", "approver", "custodian", "auditor", "viewer"],
}


def write(path: Path, data: bytes, private=False):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as stream:
        stream.write(data)
    path.chmod(0o600 if private else 0o644)


def save_key(path: Path, key):
    write(path, key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()), True)


def save_cert(path: Path, cert):
    write(path, cert.public_bytes(serialization.Encoding.PEM))


def name(cn, ou=None):
    values = [x509.NameAttribute(NameOID.ORGANIZATION_NAME, "TrustGuard local development"), x509.NameAttribute(NameOID.COMMON_NAME, cn)]
    if ou:
        values.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, ou))
    return x509.Name(values)


def ca(root: Path, cn: str):
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    subject = name(cn)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False, data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True, encipher_only=None, decipher_only=None), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False).sign(key, hashes.SHA256()))
    save_key(root / "ca.key", key)
    save_cert(root / "ca.crt", cert)
    crl = x509.CertificateRevocationListBuilder().issuer_name(subject).last_update(now-timedelta(minutes=1)).next_update(now+timedelta(days=30)).sign(key, hashes.SHA256())
    write(root / "ca.crl", crl.public_bytes(serialization.Encoding.PEM))
    return key, cert


def issue(issuer, cn, ou, *, role=None, hosts=(), client=False, server=False, not_before=None, not_after=None):
    ca_key, ca_cert = issuer
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    builder = (x509.CertificateBuilder().subject_name(name(cn, ou)).issuer_name(ca_cert.subject).public_key(key.public_key())
               .serial_number(x509.random_serial_number()).not_valid_before(not_before or now-timedelta(minutes=5)).not_valid_after(not_after or now+timedelta(days=180))
               .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
               .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False, data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=None, decipher_only=None), True)
               .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), False)
               .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False))
    if role:
        builder = builder.add_extension(x509.UnrecognizedExtension(ObjectIdentifier("1.2.3.4.5.6.7.8.1"), json.dumps({"attrs": {"trustguard.role": role}}, separators=(",", ":")).encode()), False)
    if hosts:
        sans = [x509.IPAddress(ipaddress.ip_address(host)) if host == "127.0.0.1" else x509.DNSName(host) for host in hosts]
        builder = builder.add_extension(x509.SubjectAlternativeName(sans), False)
    eku = ([ExtendedKeyUsageOID.CLIENT_AUTH] if client else []) + ([ExtendedKeyUsageOID.SERVER_AUTH] if server else [])
    if eku:
        builder = builder.add_extension(x509.ExtendedKeyUsage(eku), False)
    return key, builder.sign(ca_key, hashes.SHA256())


def msp_config():
    return {"NodeOUs": {"Enable": True, **{key: {"Certificate": "cacerts/ca.pem", "OrganizationalUnitIdentifier": ou}
            for key, ou in [("ClientOUIdentifier", "client"), ("PeerOUIdentifier", "peer"), ("AdminOUIdentifier", "admin"), ("OrdererOUIdentifier", "orderer")]}}}


def msp(root: Path, issuer, tls_issuer, identity=None):
    save_cert(root / "cacerts/ca.pem", issuer[1])
    save_cert(root / "tlscacerts/ca.pem", tls_issuer[1])
    write(root / "config.yaml", json.dumps(msp_config()).encode())
    if identity:
        save_key(root / "keystore/key.pem", identity[0])
        save_cert(root / "signcerts/cert.pem", identity[1])


def prepare(root: Path, ports: dict[str, int]):
    if root.exists():
        raise RuntimeError("Existing business runtime; refusing to regenerate any certificates")
    root.mkdir(parents=True, mode=0o700)
    api_client_ca = ca(root / "api-client-ca", "battery-api-client-ca")
    workload_ca = ca(root / "workload-ca", "battery-gateway-workload-ca")
    server_ca = ca(root / "server-ca", "battery-service-server-ca")
    clients = []
    for slug, msp_id in {**ORGANIZATIONS, "orderer": "BatteryOrdererMSP"}.items():
        base = root / "organizations" / slug
        enroll = ca(base / "enrollment-ca", f"ca.{slug}.battery.local")
        tls = ca(base / "tls-ca", f"tlsca.{slug}.battery.local")
        msp(base / "msp", enroll, tls)
        node_name = "orderer.battery.local" if slug == "orderer" else f"peer0.{slug}.battery.local"
        node = issue(enroll, node_name, "orderer" if slug == "orderer" else "peer")
        msp(base / "node/msp", enroll, tls, node)
        tls_node = issue(tls, node_name, "tls", hosts=[node_name, "localhost", "127.0.0.1"], server=True, client=True)
        save_key(base / "node/tls/server.key", tls_node[0])
        save_cert(base / "node/tls/server.crt", tls_node[1])
        save_cert(base / "node/tls/ca.crt", tls[1])
        for role in ROLES.get(slug, ["admin"]):
            identifier = slug + "-" + role
            enrollment = issue(enroll, identifier, "admin" if role == "admin" else "client", role=role)
            user_base = base / "users" / role
            msp(user_base / "msp", enroll, tls, enrollment)
            if slug == "orderer":
                continue
            api_tls = issue(api_client_ca, identifier, "api-client", client=True)
            save_key(user_base / "api.key", api_tls[0])
            save_cert(user_base / "api.crt", api_tls[1])
            clients.append({"name": identifier, "mspId": msp_id, "role": role,
                "clientFingerprint": ":".join(f"{b:02X}" for b in api_tls[1].fingerprint(hashes.SHA256())),
                "certificateFile": str(user_base / "msp/signcerts/cert.pem"), "privateKeyFile": str(user_base / "msp/keystore/key.pem"),
                "gatewayEndpoint": f"localhost:{ports[slug]}", "gatewayServerName": node_name,
                "gatewayTlsRootFile": str(base / "node/tls/ca.crt")})
    for service in ["api", "risk", "broker"]:
        key, cert = issue(server_ca, service, "service", hosts=["localhost", "127.0.0.1"], server=True)
        save_key(root / "services" / f"{service}.key", key)
        save_cert(root / "services" / f"{service}.crt", cert)
    key, cert = issue(workload_ca, "gateway", "gateway", client=True)
    save_key(root / "services/gateway-workload.key", key)
    save_cert(root / "services/gateway-workload.crt", cert)
    for purpose in ["risk-signing", "audit-signing", "permit-signing", "source-signing"]:
        key = ed25519.Ed25519PrivateKey.generate()
        save_key(root / "services" / f"{purpose}.key", key)
        write(root / "services" / f"{purpose}.pub", key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    write(root / "services/master.key", os.urandom(32), True)
    source_key = serialization.load_pem_private_key((root / "services/source-signing.key").read_bytes(),password=None)
    import base64
    write(root / "services/source-keys.json",json.dumps({"lab-source":base64.b64encode(source_key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)).decode()}).encode())
    write(root / "identities.json", json.dumps(clients, indent=2).encode(), True)
    write(root / "broker-identity.json", json.dumps(next(i for i in clients if i["name"] == "lab-viewer")).encode(), True)
    return clients
