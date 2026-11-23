"""Build and verify a separate local Fabric audit peer without changing batterybusiness."""
import argparse
import hashlib
import json
import os
import socket
import subprocess
import time
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.x509.oid import ObjectIdentifier

from business_certificates import ca, issue, msp, save_cert, save_key, write
from business_network import ORGANIZATIONS, configtx, organization, signature
from toolchain import RUNTIME, fabric_bin, fabric_config_dir

ROOT = RUNTIME.parent / "audit-peer-demo"
CHANNEL = "batteryauditdemo"
MSP = "AuditOrgMSP"
HOST = "peer0.audit.battery.local"
PEER_PORT, CHAINCODE_PORT, OPS_PORT = 25051, 25052, 25444


def run(args, *, env=None, data=None):
    result = subprocess.run([str(a) for a in args], env=env, input=data, capture_output=True, timeout=25)
    if result.returncode:
        # Subprocess diagnostics can include enrollment material.
        raise RuntimeError(f"{Path(args[0]).name} {args[1]} failed with status {result.returncode}")
    return result.stdout


def profile():
    config = configtx()
    audit = organization("audit", MSP)
    audit["MSPDir"] = str(ROOT / "msp")
    audit["AnchorPeers"] = [{"Host": "127.0.0.1", "Port": PEER_PORT}]
    channel = config["Profiles"]["BatteryChannel"]
    app = channel["Application"]
    # This isolated genesis imports only the four business organizations' public MSPs.
    for org in app["Organizations"]:
        org.pop("AnchorPeers", None)
    app["Organizations"].append(audit)
    config["Organizations"].append(audit)
    for name, role in [("Admins", "admin"), ("Endorsement", "peer"), ("LifecycleEndorsement", "peer")]:
        voters = ", ".join(f"'{org}.{role}'" for org in ORGANIZATIONS.values())
        app["Policies"][name] = signature(f"OutOf(3, {voters})")
    orderer = channel["Orderer"]
    orderer["Organizations"][0]["OrdererEndpoints"] = ["127.0.0.1:25950"]
    orderer["EtcdRaft"]["Consenters"][0].update(Host="127.0.0.1", Port=25950)
    return config


def initialize():
    ROOT.mkdir(mode=0o700, exist_ok=False)
    enrollment = ca(ROOT / "enrollment-ca", "ca.audit.battery.local")
    tls = ca(ROOT / "tls-ca", "tlsca.audit.battery.local")
    msp(ROOT / "msp", enrollment, tls)
    msp(ROOT / "node/msp", enrollment, tls, issue(enrollment, HOST, "peer"))
    for role, ou in [("admin", "admin"), ("auditor", "client")]:
        msp(ROOT / "users" / role / "msp", enrollment, tls,
            issue(enrollment, "audit-" + role, ou, role=role))
    node_key, node_cert = issue(tls, HOST, "tls", hosts=[HOST, "localhost", "127.0.0.1"], server=True, client=True)
    save_key(ROOT / "node/tls/server.key", node_key)
    save_cert(ROOT / "node/tls/server.crt", node_cert)
    save_cert(ROOT / "node/tls/ca.crt", tls[1])
    write(ROOT / "configtx.yaml", json.dumps(profile(), indent=2).encode())
    config_env = {**os.environ, "FABRIC_CFG_PATH": str(ROOT)}
    org = run([fabric_bin("configtxgen"), "-printOrg", MSP], env=config_env)
    write(ROOT / "audit-organization.json", org)
    run([fabric_bin("configtxgen"), "-profile", "BatteryChannel", "-channelID", CHANNEL,
         "-outputBlock", ROOT / "genesis.block"], env=config_env)


def peer_env(role=None):
    address = f"127.0.0.1:{PEER_PORT}"
    chaincode = f"127.0.0.1:{CHAINCODE_PORT}"
    return {**os.environ, "FABRIC_CFG_PATH": str(fabric_config_dir()), "FABRIC_LOGGING_SPEC": "warning",
            "CORE_PEER_ID": HOST, "CORE_PEER_LOCALMSPID": MSP,
            "CORE_PEER_FILESYSTEMPATH": str(ROOT / "ledger"), "CORE_LEDGER_STATE_STATEDATABASE": "goleveldb",
            "CORE_LEDGER_SNAPSHOTS_ROOTDIR": str(ROOT / "snapshots"),
            "CORE_PEER_MSPCONFIGPATH": str(ROOT / ("users/" + role if role else "node") / "msp"),
            "CORE_PEER_ADDRESS": address, "CORE_PEER_LISTENADDRESS": address,
            "CORE_PEER_CHAINCODEADDRESS": chaincode, "CORE_PEER_CHAINCODELISTENADDRESS": chaincode,
            "CORE_PEER_GOSSIP_BOOTSTRAP": address, "CORE_PEER_GOSSIP_EXTERNALENDPOINT": address,
            "CORE_PEER_GOSSIP_USELEADERELECTION": "false", "CORE_PEER_GOSSIP_ORGLEADER": "false",
            "CORE_OPERATIONS_LISTENADDRESS": f"127.0.0.1:{OPS_PORT}",
            "CORE_PEER_TLS_ENABLED": "true", "CORE_PEER_TLS_CERT_FILE": str(ROOT / "node/tls/server.crt"),
            "CORE_PEER_TLS_KEY_FILE": str(ROOT / "node/tls/server.key"),
            "CORE_PEER_TLS_ROOTCERT_FILE": str(ROOT / "node/tls/ca.crt")}


def verify():
    def cert(path):
        return x509.load_pem_x509_certificate(path.read_bytes())

    root_cert = cert(ROOT / "msp/cacerts/ca.pem")
    roots = {cert(RUNTIME / "organizations" / slug / "msp/cacerts/ca.pem").fingerprint(hashes.SHA256())
             for slug in ORGANIZATIONS}
    if root_cert.fingerprint(hashes.SHA256()) in roots or len(roots) != 4:
        raise RuntimeError("audit enrollment must use a separate trust root")
    cert(ROOT / "node/msp/signcerts/cert.pem").verify_directly_issued_by(root_cert)
    auditor = cert(ROOT / "users/auditor/msp/signcerts/cert.pem")
    auditor.verify_directly_issued_by(root_cert)
    attrs = auditor.extensions.get_extension_for_oid(ObjectIdentifier("1.2.3.4.5.6.7.8.1")).value
    if json.loads(attrs.value)["attrs"]["trustguard.role"] != "auditor":
        raise RuntimeError("audit client certificate is missing the audit role")
    block = ROOT / "genesis.block"
    content = json.loads(run([fabric_bin("configtxgen"), "-inspectBlock", block],
                             env={**os.environ, "FABRIC_CFG_PATH": str(ROOT)}))
    payload = content["data"]["data"][0]["payload"]
    app = payload["data"]["config"]["channel_group"]["groups"]["Application"]
    if payload["header"]["channel_header"]["channel_id"] != CHANNEL or set(app["groups"]) != {*ORGANIZATIONS.values(), MSP}:
        raise RuntimeError("unexpected genesis channel or membership")
    for key in ["Admins", "Endorsement", "LifecycleEndorsement"]:
        policy = app["policies"][key]["policy"]["value"]
        voters = {entry["principal"]["msp_identifier"] for entry in policy["identities"]}
        if voters != set(ORGANIZATIONS.values()) or policy["rule"]["n_out_of"]["n"] != 3:
            raise RuntimeError("unexpected business governance policy")
    # Refuse to join an existing listener. Only the child started below may receive this genesis.
    for port in [PEER_PORT, CHAINCODE_PORT, OPS_PORT]:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    peer = fabric_bin("peer")
    with (ROOT / "peer.log").open("a") as log:
        process = subprocess.Popen([peer, "node", "start"], env=peer_env(), stdout=log, stderr=log)
        try:
            for _ in range(70):
                if process.poll() is not None:
                    raise RuntimeError("isolated peer stopped during startup, see its local peer.log")
                try:
                    channels = run([peer, "channel", "list"], env=peer_env("admin")).decode().splitlines()
                    break
                except RuntimeError:
                    time.sleep(0.2)
            else:
                raise RuntimeError("isolated peer did not become ready")
            if CHANNEL not in channels:
                run([peer, "channel", "join", "-b", block], env=peer_env("admin"))
            result = run([peer, "channel", "getinfo", "-c", CHANNEL], env=peer_env("auditor")).decode()
            info = json.loads(result[result.index("{"):])
            if int(info["height"]) != 1:
                raise RuntimeError("unexpected isolated ledger height")
            # Peers add validation metadata upon joining. Compare the signed envelope and header.
            query = json.dumps({"Args": ["GetBlockByNumber", CHANNEL, "0"]})
            fetched = run([peer, "chaincode", "query", "-C", CHANNEL, "-n", "qscc", "-c", query, "--hex"],
                          env=peer_env("auditor"))
            expected = block.read_bytes()
            decoder = [fabric_bin("configtxlator"), "proto_decode", "--type", "common.Block"]
            observed = json.loads(run(decoder, data=bytes.fromhex(fetched.decode().strip())))
            if observed["header"] != content["header"] or observed["data"] != content["data"]:
                raise RuntimeError("auditor's block header or envelope differs from the configured genesis")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    print(json.dumps({"channel": CHANNEL, "msp": MSP, "members": sorted(app["groups"]), "ledgerHeight": 1,
                      "genesisSha256": hashlib.sha256(expected).hexdigest(), "auditorReadVerified": True,
                      "businessEndorsersRequired": 3, "eligibleBusinessOrganizations": 4}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "verify"])
    args = parser.parse_args()
    if args.action == "init":
        initialize()
    else:
        verify()
