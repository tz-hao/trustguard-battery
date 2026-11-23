"""Enroll a dedicated audit peer on the existing batterybusiness channel.

Run on the target host. prepare saves the proposed change, submit signs and sends it,
join starts the persistent peer, and verify reads the original and current ledgers.
"""
import argparse
import copy
import json
import os
import subprocess
import time
from pathlib import Path

from business_certificates import ca, issue, msp, save_cert, save_key
from business_network import CHANNEL, FABRIC, NETWORK, ORGANIZATIONS, organization, peer_environment
from toolchain import RUNTIME, fabric_bin

MSP = "AuditOrgMSP"
HOST = "peer0.audit.battery.local"
BASE = RUNTIME.parent / "server-audit-org"
PEER = fabric_bin("peer")
TRANSLATOR = fabric_bin("configtxlator")
BUSINESS = list(ORGANIZATIONS.values())
TLS = RUNTIME / "organizations/orderer/node/tls/ca.crt"
ORDERER = ["-o", "localhost:17050", "--ordererTLSHostnameOverride", "orderer.battery.local", "--tls", "--cafile", TLS]
VOTES = {"Admins": "ADMIN", "Endorsement": "PEER", "LifecycleEndorsement": "PEER"}


def run(*args, data=None, env=None, timeout=45):
    result = subprocess.run([str(x) for x in args], input=data, capture_output=True, env=env, timeout=timeout)
    if result.returncode:
        # Keep binary envelopes and identity material out of logs.
        last = result.stderr.decode(errors="replace").strip().splitlines()[-1:]
        detail = last[0][:380] if last and "-----" not in last[0] else ""
        raise RuntimeError(f"{Path(args[0]).name} {args[1]} failed: {detail}")
    return result.stdout


def encode(kind, obj):
    return run(TRANSLATOR, "proto_encode", "--type", kind, data=json.dumps(obj).encode())


def decode(kind, raw):
    return json.loads(run(TRANSLATOR, "proto_decode", "--type", kind, data=raw))


def query(system, command, env):
    return bytes.fromhex(run(PEER, "chaincode", "query", "-C", CHANNEL, "-n", system, "-c",
                             json.dumps({"Args": command}), "--hex", env=env).decode().strip())


def config(env):
    return decode("common.Config", query("cscc", ["GetChannelConfig", CHANNEL], env))


def app(cfg):
    return cfg["channel_group"]["groups"]["Application"]


def enroll():
    base = BASE / "identities"
    if base.exists():
        if not (base / "public-org.json").is_file():
            raise RuntimeError("Incomplete enrollment. Inspect retained files before continuing")
        return json.loads((base / "public-org.json").read_text())
    base.mkdir(mode=0o700)
    issuer = ca(base / "enrollment-ca", "ca.audit.battery.local")
    tls = ca(base / "tls-ca", "tlsca.audit.battery.local")
    msp(base / "msp", issuer, tls)
    msp(base / "node/msp", issuer, tls, issue(issuer, HOST, "peer"))
    for name, ou in [("admin", "admin"), ("auditor", "client")]:
        msp(base / "users" / name / "msp", issuer, tls, issue(issuer, "audit-" + name, ou, role=name))
    key, cert = issue(tls, HOST, "tls", hosts=[HOST, "localhost", "127.0.0.1"], client=True, server=True)
    save_key(base / "node/tls/server.key", key)
    save_cert(base / "node/tls/server.crt", cert)
    save_cert(base / "node/tls/ca.crt", tls[1])
    org = organization("audit", MSP)
    org["MSPDir"] = str(base / "msp")
    (base / "configtx.yaml").write_text(json.dumps({"Organizations": [org]}))
    public = json.loads(run(fabric_bin("configtxgen"), "-printOrg", MSP, env=dict(os.environ, FABRIC_CFG_PATH=str(base))))
    (base / "public-org.json").write_text(json.dumps(public))
    return public


def pinned_policy(role):
    return {"type": 1, "value": {"version": 0, "identities": [
        {"principal_classification": "ROLE", "principal": {"msp_identifier": org, "role": role}} for org in BUSINESS],
        "rule": {"n_out_of": {"n": 3, "rules": [{"signed_by": i} for i in range(4)]}}}}


def prepare():
    BASE.mkdir(exist_ok=True, mode=0o700)
    original = config(peer_environment("cell"))
    assert set(app(original)["groups"]) == set(BUSINESS)
    for slug in ORGANIZATIONS:
        assert config(peer_environment(slug)) == original
    proposed = copy.deepcopy(original)
    a = app(proposed)
    for key, role in VOTES.items():
        sub = "Admins" if role == "ADMIN" else "Endorsement"
        assert a["policies"][key]["policy"] == {"type": 3, "value": {"rule": "MAJORITY", "sub_policy": sub}}
        for org in BUSINESS:
            old = a["groups"][org]["policies"][sub]["policy"]["value"]
            assert [i["principal"] for i in old["identities"]] == [{"msp_identifier": org, "role": role}]
            assert old["rule"] == {"n_out_of": {"n": 1, "rules": [{"signed_by": 0}]}}
        a["policies"][key]["policy"] = pinned_policy(role)
    a["groups"][MSP] = enroll()
    for name, cfg in [("original", original), ("proposed", proposed)]:
        (BASE / (name + ".pb")).write_bytes(encode("common.Config", cfg))
    delta = decode("common.ConfigUpdate", run(TRANSLATOR, "compute_update", "--channel_id", CHANNEL,
                   "--original", BASE / "original.pb", "--updated", BASE / "proposed.pb"))
    write = delta["write_set"]
    assert set(write["groups"]) == {"Application"} and not write.get("values") and not write.get("policies")
    edited = write["groups"]["Application"]
    assert set(edited["groups"]) == {MSP, *BUSINESS} and not any(edited["groups"][o].get(k) for o in BUSINESS for k in ["values","policies","groups"])
    for key, val in edited["policies"].items():
        if key not in VOTES:
            assert not val.get("policy")
    assert VOTES.keys() <= edited["policies"].keys() and not any(v.get("value") for v in edited.get("values", {}).values())
    envelope = {"payload": {"header": {"channel_header": {"channel_id": CHANNEL, "type": 2}},
                            "data": {"config_update": delta}}}
    (BASE / "unsigned.pb").write_bytes(encode("common.Envelope", envelope))
    print("Prepared audit member and three business-only quorum policies")


def submit():
    current = config(peer_environment("cell"))
    if MSP in app(current)["groups"]:
        verify_config()
        return
    assert current == decode("common.Config", (BASE / "original.pb").read_bytes())
    file = BASE / "signed.pb"
    file.write_bytes((BASE / "unsigned.pb").read_bytes())
    for slug in ["cell", "pack", "lab"]:
        run(PEER, "channel", "signconfigtx", "-f", file, env=peer_environment(slug))
    run(PEER, "channel", "update", "-c", CHANNEL, "-f", file, *ORDERER, env=peer_environment("recycle"))
    print("Submitted channel configuration")


def verify_config():
    wanted = decode("common.Config", (BASE / "proposed.pb").read_bytes())
    def content(group):
        # Fabric increments ConfigGroup, ConfigValue and ConfigPolicy revisions on commit.
        # Retain every field inside the policies, values and MSP definitions.
        result = copy.deepcopy(group)
        result.pop("version", None)
        for entries in (result["policies"], result["values"]):
            for entry in entries.values():
                entry.pop("version", None)
        result["groups"] = {key: content(child) for key,child in result["groups"].items()}
        return result
    for slug in ORGANIZATIONS:
        actual = config(peer_environment(slug))
        assert int(actual["sequence"]) == int(wanted["sequence"]) + 1
        assert content(actual["channel_group"]) == content(wanted["channel_group"])
    print("Four existing peers verified exact membership and business quorum policies")


def audit_env(role):
    base = BASE / "identities"
    return {**peer_environment("cell"), "CORE_PEER_LOCALMSPID": MSP, "CORE_PEER_ADDRESS": "localhost:25051",
            "CORE_PEER_TLS_SERVERHOSTOVERRIDE": HOST, "CORE_PEER_TLS_ROOTCERT_FILE": str(base / "node/tls/ca.crt"),
            "CORE_PEER_MSPCONFIGPATH": str(base / "users" / role / "msp")}


def join():
    verify_config()
    base = BASE / "identities/node"
    ledger = BASE / "peer-ledger"
    ledger.mkdir(mode=0o700, exist_ok=True)
    current = run("docker", "ps", "-a", "--filter", "name=^/"+HOST+"$", "--format", "{{.Names}}").decode().strip()
    if not current:
        env = {"CORE_PEER_ID":HOST, "CORE_PEER_ADDRESS":HOST+":7051", "CORE_PEER_LISTENADDRESS":"0.0.0.0:7051",
               "CORE_PEER_LOCALMSPID":MSP, "CORE_PEER_MSPCONFIGPATH":"/audit/msp", "CORE_PEER_TLS_ENABLED":"true",
               "CORE_PEER_TLS_CERT_FILE":"/audit/tls/server.crt","CORE_PEER_TLS_KEY_FILE":"/audit/tls/server.key",
               "CORE_PEER_TLS_ROOTCERT_FILE":"/audit/tls/ca.crt","CORE_PEER_GOSSIP_EXTERNALENDPOINT":HOST+":7051",
               "CORE_PEER_GOSSIP_BOOTSTRAP":HOST+":7051","CORE_PEER_GOSSIP_USELEADERELECTION":"false",
               "CORE_PEER_GOSSIP_ORGLEADER":"true","CORE_LEDGER_STATE_STATEDATABASE":"goleveldb"}
        env_args = [arg for k,v in env.items() for arg in ("-e", k+"="+v)]
        run("docker", "run", "-d", "--restart", "unless-stopped", "--network", NETWORK, "--hostname", HOST, "--name", HOST,
            "--label", "trustguard.role=audit-peer", "-p", "127.0.0.1:25051:7051",
            "-v", str(base)+":/audit:ro", "-v", str(ledger)+":/var/hyperledger/production", *env_args,
            "ghcr.io/hyperledger/fabric-peer:"+FABRIC, "peer", "node", "start")
    else:
        assert run("docker","inspect","-f",'{{index .Config.Labels "trustguard.role"}}',HOST).strip()==b"audit-peer"
        run("docker","start",HOST)
    admin = audit_env("admin")
    for i in range(30):
        try:
            channels = run(PEER, "channel", "list", env=admin).decode().splitlines()
            break
        except RuntimeError:
            if i==29: raise
            time.sleep(1)
    if CHANNEL not in channels:
        genesis = BASE / "business-genesis.block"
        run(PEER, "channel", "fetch", "0", genesis, "-c", CHANNEL, *ORDERER, env=peer_environment("cell"))
        run(PEER, "channel", "join", "-b", genesis, env=admin)
    print("Audit peer joined original business channel")


def verify_block(number):
    raw = query("qscc", ["GetBlockByNumber", CHANNEL, str(number)], audit_env("auditor"))
    ref = query("qscc", ["GetBlockByNumber", CHANNEL, str(number)], peer_environment("cell"))
    block = decode("common.Block", raw)
    assert block["header"] == decode("common.Block", ref)["header"]
    assert block["data"] == decode("common.Block", ref)["data"]
    assert block["metadata"]["metadata"][2] == decode("common.Block", ref)["metadata"]["metadata"][2]
    print(json.dumps({"block":number,"readAs":MSP,"header":block["header"],"matchesBusinessPeer":True}))


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Configuration checks require normal Python mode")
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare","submit","join","config","block"])
    parser.add_argument("--number", type=int)
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == "block":
        if args.number is None or args.number<0: parser.error("--number is required")
        verify_block(args.number)
    else:
        {"prepare": prepare,"submit":submit,"join":join,"config":verify_config}[args.action]()
