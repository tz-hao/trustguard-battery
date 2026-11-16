#!/usr/bin/env python3
"""Project-isolated local Fabric lifecycle. No down/reset/prune operation exists."""
from __future__ import annotations

import argparse
import io
import json
import os
import secrets
import shutil
import socket
import subprocess
import tarfile
import time
from pathlib import Path

from business_certificates import ORGANIZATIONS, prepare, write
from toolchain import (
    DOCKER,
    ROOT,
    RUNTIME,
    fabric_bin,
    fabric_config_dir,
    resolve_fabric_root,
    resolve_go,
)

PROJECT = "trustguard-battery-business"
NETWORK = "trustguard_battery_business"
PORTS = {"cell": 17051, "pack": 19051, "lab": 21051, "recycle": 23051}
FABRIC = "2.5.16"
CHANNEL = "batterybusiness"


def run(args, *, env=None, data=None, capture=False, cwd=None):
    # No command echoes: arguments and environment may reference private runtime files.
    result = subprocess.run([str(a) for a in args], env=env, input=data, cwd=cwd,
                            stdout=subprocess.PIPE if capture else None, check=True)
    return result.stdout.decode().strip() if capture else None


def dump(path, data, private=False):
    write(path, (json.dumps(data, indent=2) + "\n").encode(), private)


def wait_tcp(port: int, timeout_seconds: int = 45):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for 127.0.0.1:{port} to become ready")


def signature(rule):
    return {"Type": "Signature", "Rule": rule}


def meta(rule):
    return {"Type": "ImplicitMeta", "Rule": rule}


def organization(slug, msp_id):
    value = {"Name": msp_id, "ID": msp_id, "MSPDir": str(RUNTIME / "organizations" / slug / "msp"),
             "Policies": {"Readers": signature(f"OR('{msp_id}.member')"),
                          "Writers": signature(f"OR('{msp_id}.admin','{msp_id}.client')"),
                          "Admins": signature(f"OR('{msp_id}.admin')"),
                          "Endorsement": signature(f"OR('{msp_id}.peer')")}}
    if slug == "orderer":
        value["OrdererEndpoints"] = ["orderer.battery.local:7050"]
        # Blocks are signed by an orderer OU identity, not an application client/admin.
        value["Policies"]["Writers"] = signature(f"OR('{msp_id}.member')")
    else:
        value["AnchorPeers"] = [{"Host": f"peer0.{slug}.battery.local", "Port": 7051}]
    return value


def configtx():
    peers = [organization(slug, msp) for slug, msp in ORGANIZATIONS.items()]
    orderer_org = organization("orderer", "BatteryOrdererMSP")
    shared = {"Readers": meta("ANY Readers"), "Writers": meta("ANY Writers"), "Admins": meta("MAJORITY Admins")}
    orderer = {"OrdererType": "etcdraft", "BatchTimeout": "1s", "BatchSize": {"MaxMessageCount": 10, "AbsoluteMaxBytes": "10 MB", "PreferredMaxBytes": "2 MB"},
               "EtcdRaft": {"Consenters": [{"Host": "orderer.battery.local", "Port": 7050,
                   "ClientTLSCert": str(RUNTIME / "organizations/orderer/node/tls/server.crt"),
                   "ServerTLSCert": str(RUNTIME / "organizations/orderer/node/tls/server.crt")}]},
               "Organizations": [orderer_org], "Policies": {**shared, "BlockValidation": meta("ANY Writers")}, "Capabilities": {"V2_0": True}}
    application = {"Organizations": peers, "Policies": {**shared, "LifecycleEndorsement": meta("MAJORITY Endorsement"), "Endorsement": meta("MAJORITY Endorsement")}, "Capabilities": {"V2_5": True}}
    profile = {"Policies": shared, "Capabilities": {"V2_0": True}, "Orderer": orderer, "Application": application}
    return {"Organizations": [orderer_org] + peers, "Profiles": {"BatteryChannel": profile}}


def generate():
    core_yaml = fabric_config_dir() / "core.yaml"
    prepare(RUNTIME, PORTS)
    for slug in [*ORGANIZATIONS, "orderer"]:
        node = RUNTIME / "organizations" / slug / "node"
        if slug != "orderer":
            shutil.copyfile(core_yaml, node / "core.yaml")
    dump(RUNTIME / "configtx.yaml", configtx())
    database_admin = secrets.token_hex(24)
    database_api = secrets.token_hex(24)
    database_broker = secrets.token_hex(24)
    s3_user = "trustguard" + secrets.token_hex(6)
    s3_password = secrets.token_hex(24)
    write(RUNTIME / "postgres-secrets/password", database_admin.encode(), True)
    init = f"CREATE ROLE trustguard_api LOGIN PASSWORD '{database_api}';\nCREATE ROLE trustguard_broker LOGIN PASSWORD '{database_broker}';\nGRANT CONNECT ON DATABASE trustguard TO trustguard_api,trustguard_broker;\nGRANT USAGE,CREATE ON SCHEMA public TO trustguard_api;\nGRANT USAGE ON SCHEMA public TO trustguard_broker;\n"
    write(RUNTIME / "postgres-init/001_roles.sql", init.encode(), True)
    write(RUNTIME / "minio-secrets/rootuser", s3_user.encode(), True)
    write(RUNTIME / "minio-secrets/rootpassword", s3_password.encode(), True)
    dump(RUNTIME / "services/s3-credentials.json", {"accessKeyId": s3_user, "secretAccessKey": s3_password}, True)
    env = {
        "TRUSTGUARD_CHANNEL": CHANNEL,
        "TRUSTGUARD_DATABASE_URL": f"postgresql://trustguard_api:{database_api}@127.0.0.1:15432/trustguard",
        "TRUSTGUARD_BROKER_DATABASE_URL": f"postgresql://trustguard_broker:{database_broker}@127.0.0.1:15432/trustguard",
        "TRUSTGUARD_IDENTITIES_FILE": str(RUNTIME / "identities.json"),
        "TRUSTGUARD_TLS_CERT": str(RUNTIME / "services/api.crt"), "TRUSTGUARD_TLS_KEY": str(RUNTIME / "services/api.key"),
        "TRUSTGUARD_CLIENT_CA_FILE": str(RUNTIME / "api-client-ca/ca.crt"), "TRUSTGUARD_CLIENT_CRL_FILE": str(RUNTIME / "api-client-ca/ca.crl"),
        "TRUSTGUARD_WORKLOAD_CERT": str(RUNTIME / "services/gateway-workload.crt"), "TRUSTGUARD_WORKLOAD_KEY": str(RUNTIME / "services/gateway-workload.key"),
        "TRUSTGUARD_INTERNAL_SERVER_CA": str(RUNTIME / "server-ca/ca.crt"),
        "TRUSTGUARD_AUDIT_KEY_FILE": str(RUNTIME / "services/audit-signing.key"), "TRUSTGUARD_PERMIT_KEY_FILE": str(RUNTIME / "services/permit-signing.key"),
        "TRUSTGUARD_PERMIT_PUBLIC_KEY_FILE": str(RUNTIME / "services/permit-signing.pub"), "TRUSTGUARD_BROKER_IDENTITY_FILE": str(RUNTIME / "broker-identity.json"),
        "TRUSTGUARD_MASTER_KEY_FILE": str(RUNTIME / "services/master.key"), "TRUSTGUARD_VAULT_DIRECTORY": str(RUNTIME / "vault"),
        "TRUSTGUARD_BROKER_TLS_CERT": str(RUNTIME / "services/broker.crt"), "TRUSTGUARD_BROKER_TLS_KEY": str(RUNTIME / "services/broker.key"),
        "TRUSTGUARD_GATEWAY_CLIENT_CA": str(RUNTIME / "workload-ca/ca.crt"), "TRUSTGUARD_GATEWAY_CLIENT_CRL": str(RUNTIME / "workload-ca/ca.crl"),
        "TRUSTGUARD_S3_ENDPOINT": "http://127.0.0.1:19000", "TRUSTGUARD_REPORT_BUCKET": "battery-reports",
        "TRUSTGUARD_S3_CREDENTIALS_FILE": str(RUNTIME / "services/s3-credentials.json"),
        "TRUSTGUARD_RISK_KEY_FILE": str(RUNTIME / "services/risk-signing.key"), "TRUSTGUARD_REFERENCE_FILE": str(RUNTIME / "quality-reference.json"),
        "TRUSTGUARD_SOURCE_KEYS_FILE": str(RUNTIME / "services/source-keys.json"),
    }
    dump(RUNTIME / "service-environment.json", env, True)
    dump(RUNTIME / "compose.json", compose())
    print("Prepared independent local business MSPs and configuration; no network started")


def compose():
    services, volumes = {}, {}
    def volume(name):
        volumes[name] = {"name": f"{PROJECT}_{name}"}
        return name
    def mount(source, target, readonly=False):
        return {"type": "volume", "source": volume(source), "target": target, "read_only": readonly}
    def ports(host, internal):
        return {"target": internal, "published": str(host), "host_ip": "127.0.0.1", "protocol": "tcp"}
    for index, (slug, msp) in enumerate(ORGANIZATIONS.items()):
        host = f"peer0.{slug}.battery.local"
        services[slug] = {"container_name": host, "hostname": host, "image": f"ghcr.io/hyperledger/fabric-peer:{FABRIC}",
            "command": ["peer", "node", "start"], "working_dir": "/root", "networks": {"business": {"aliases": [host]}},
            "ports": [ports(PORTS[slug], 7051), ports(17444+index, 9444)],
            "volumes": [mount("cfg-"+slug, "/etc/hyperledger/fabric", True), mount("ledger-"+slug, "/var/hyperledger/production"),
                        {"type": "bind", "source": "/var/run/docker.sock", "target": "/host/var/run/docker.sock"}],
            "environment": {"FABRIC_LOGGING_SPEC": "info", "FABRIC_CFG_PATH": "/etc/hyperledger/fabric", "CORE_PEER_ID": host,
                "CORE_PEER_ADDRESS": host+":7051", "CORE_PEER_LISTENADDRESS": "0.0.0.0:7051", "CORE_PEER_CHAINCODEADDRESS": host+":7052", "CORE_PEER_CHAINCODELISTENADDRESS": "0.0.0.0:7052",
                "CORE_PEER_GOSSIP_BOOTSTRAP": host+":7051", "CORE_PEER_GOSSIP_EXTERNALENDPOINT": host+":7051", "CORE_PEER_LOCALMSPID": msp,
                "CORE_PEER_MSPCONFIGPATH": "/etc/hyperledger/fabric/msp", "CORE_PEER_TLS_ENABLED": "true", "CORE_PEER_TLS_CERT_FILE": "/etc/hyperledger/fabric/tls/server.crt",
                "CORE_PEER_TLS_KEY_FILE": "/etc/hyperledger/fabric/tls/server.key", "CORE_PEER_TLS_ROOTCERT_FILE": "/etc/hyperledger/fabric/tls/ca.crt",
                "CORE_OPERATIONS_LISTENADDRESS": "0.0.0.0:9444", "CORE_VM_ENDPOINT": "unix:///host/var/run/docker.sock", "CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE": NETWORK,
                "CORE_CHAINCODE_BUILDER": f"ghcr.io/hyperledger/fabric-ccenv:{FABRIC}", "CORE_CHAINCODE_GOLANG_RUNTIME": f"ghcr.io/hyperledger/fabric-baseos:{FABRIC}"}}
    services["orderer"] = {"container_name": "orderer.battery.local", "hostname": "orderer.battery.local", "image": f"ghcr.io/hyperledger/fabric-orderer:{FABRIC}",
        "command": ["orderer"], "networks": {"business": {"aliases": ["orderer.battery.local"]}}, "ports": [ports(17050,7050), ports(17053,7053), ports(17443,9443)],
        "volumes": [mount("cfg-orderer","/etc/hyperledger/orderer",True),mount("ledger-orderer","/var/hyperledger/production/orderer")],
        "environment": {"FABRIC_LOGGING_SPEC":"info", "ORDERER_GENERAL_LISTENADDRESS":"0.0.0.0", "ORDERER_GENERAL_LISTENPORT":"7050", "ORDERER_GENERAL_LOCALMSPID":"BatteryOrdererMSP",
            "ORDERER_GENERAL_LOCALMSPDIR":"/etc/hyperledger/orderer/msp", "ORDERER_GENERAL_TLS_ENABLED":"true", "ORDERER_GENERAL_TLS_PRIVATEKEY":"/etc/hyperledger/orderer/tls/server.key",
            "ORDERER_GENERAL_TLS_CERTIFICATE":"/etc/hyperledger/orderer/tls/server.crt", "ORDERER_GENERAL_TLS_ROOTCAS":"[/etc/hyperledger/orderer/tls/ca.crt]",
            "ORDERER_GENERAL_CLUSTER_CLIENTCERTIFICATE":"/etc/hyperledger/orderer/tls/server.crt", "ORDERER_GENERAL_CLUSTER_CLIENTPRIVATEKEY":"/etc/hyperledger/orderer/tls/server.key",
            "ORDERER_GENERAL_CLUSTER_ROOTCAS":"[/etc/hyperledger/orderer/tls/ca.crt]", "ORDERER_GENERAL_BOOTSTRAPMETHOD":"none", "ORDERER_CHANNELPARTICIPATION_ENABLED":"true",
            "ORDERER_ADMIN_TLS_ENABLED":"true", "ORDERER_ADMIN_TLS_CERTIFICATE":"/etc/hyperledger/orderer/tls/server.crt", "ORDERER_ADMIN_TLS_PRIVATEKEY":"/etc/hyperledger/orderer/tls/server.key",
            "ORDERER_ADMIN_TLS_ROOTCAS":"[/etc/hyperledger/orderer/tls/ca.crt]", "ORDERER_ADMIN_TLS_CLIENTROOTCAS":"[/etc/hyperledger/orderer/tls/ca.crt]", "ORDERER_ADMIN_LISTENADDRESS":"0.0.0.0:7053", "ORDERER_OPERATIONS_LISTENADDRESS":"0.0.0.0:9443"}}
    services["postgres"] = {"container_name":"tg-battery-postgres", "image":"postgres:16-alpine", "networks":["business"], "ports":[ports(15432,5432)],
        "environment":{"POSTGRES_USER":"trustguard_admin","POSTGRES_DB":"trustguard","POSTGRES_PASSWORD_FILE":"/run/secrets/password"},
        "volumes":[mount("postgres-data","/var/lib/postgresql/data"),mount("cfg-postgres-secrets","/run/secrets",True),mount("cfg-postgres-init","/docker-entrypoint-initdb.d",True)],
        "healthcheck":{"test":["CMD-SHELL","pg_isready -U trustguard_admin -d trustguard"],"interval":"3s","timeout":"3s","retries":20}}
    minio_image = os.environ.get("TRUSTGUARD_MINIO_IMAGE", "trustguard/minio:2025-10-15")
    minio_service = {"container_name":"tg-battery-minio", "image":minio_image, "networks":["business"], "ports":[ports(19000,9000)],
        "command":["server","/data","--address",":9000"], "environment":{"MINIO_ROOT_USER_FILE":"/run/secrets/rootuser","MINIO_ROOT_PASSWORD_FILE":"/run/secrets/rootpassword","MINIO_BROWSER":"off"},
        "volumes":[mount("minio-data","/data"),mount("cfg-minio-secrets","/run/secrets",True)]}
    if minio_image.startswith("trustguard/minio"):
        minio_service["entrypoint"] = ["/minio"]
    services["minio"] = minio_service
    return {"name":PROJECT,"services":services,"networks":{"business":{"name":NETWORK}},"volumes":volumes}


def seed_volume(name: str, source: Path):
    full = PROJECT + "_" + name
    existing = run([DOCKER,"volume","ls","--filter",f"name=^{full}$","--format","{{.Name}}"],capture=True)
    if existing:
        raise RuntimeError("Existing config volume; refusing to overwrite")
    run([DOCKER,"volume","create","--label",f"com.docker.compose.project={PROJECT}",full],capture=True)
    helper = PROJECT + "-seed-" + name
    run([DOCKER,"create","--name",helper,"--network","none","--mount",f"type=volume,source={full},target=/target","--entrypoint","/bin/true","postgres:16-alpine"],capture=True)
    data = io.BytesIO()
    with tarfile.open(fileobj=data,mode="w") as archive:
        def ownership(info):
            info.uid = 70 if name.startswith("cfg-postgres-") else 0
            info.gid = info.uid
            info.uname = info.gname = ""
            return info
        for item in source.iterdir():
            archive.add(item,arcname=item.name,filter=ownership)
    run([DOCKER,"cp","-",helper+":/target"],data=data.getvalue(),capture=True)
    run([DOCKER,"rm",helper],capture=True)


def up(include_storage=True):
    config = json.loads((RUNTIME / "compose.json").read_text())
    names = set(run([DOCKER,"ps","-a","--format","{{.Names}}"],capture=True).splitlines())
    if names & {service["container_name"] for service in config["services"].values()}:
        raise RuntimeError("Business containers already exist; use resume, never regenerate")
    if include_storage:
        minio_image = config["services"]["minio"]["image"]
        existing = run([DOCKER,"images","-q",minio_image],capture=True)
        if not existing:
            if minio_image.startswith("trustguard/minio"):
                raise RuntimeError(
                    f"Missing local MinIO image '{minio_image}'. "
                    "Run '.venv/bin/python infrastructure/scripts/import_minio.py' first, "
                    "or set TRUSTGUARD_MINIO_IMAGE."
                )
            run([DOCKER,"pull",minio_image])
    for slug in [*ORGANIZATIONS,"orderer"]:
        seed_volume("cfg-"+slug,RUNTIME / "organizations" / slug / "node")
    for name in ["postgres-secrets","postgres-init","minio-secrets"]:
        seed_volume("cfg-"+name,RUNTIME / name)
    selected=[] if include_storage else [*ORGANIZATIONS,"orderer","postgres"]
    run([DOCKER,"compose","-p",PROJECT,"-f","-","up","-d",*selected],data=json.dumps(config).encode())


def peer_environment(slug):
    env = dict(os.environ)
    path_parts = []
    go_bin = Path(resolve_go())
    path_parts.append(str(go_bin.parent))
    fabric_root = resolve_fabric_root()
    if fabric_root and (fabric_root / "bin").is_dir():
        path_parts.append(str(fabric_root / "bin"))
    path_parts.append(env.get("PATH", ""))
    env.update({
        "PATH": os.pathsep.join(p for p in path_parts if p),
        "GOPATH": str(ROOT / ".tools/gopath"),
        "GOCACHE": str(ROOT / ".tools/go-build"),
        "GOFLAGS": "-buildvcs=false",
    })
    if "GOTOOLCHAIN" not in env and go_bin == ROOT / ".tools/go1.26.4/bin/go":
        env["GOTOOLCHAIN"] = "local"
    env.update({
        "FABRIC_CFG_PATH": str(fabric_config_dir()),
        "CORE_PEER_TLS_ENABLED": "true",
        "CORE_PEER_LOCALMSPID": ORGANIZATIONS[slug],
        "CORE_PEER_MSPCONFIGPATH": str(RUNTIME / "organizations" / slug / "users/admin/msp"),
        "CORE_PEER_ADDRESS": f"localhost:{PORTS[slug]}",
        "CORE_PEER_TLS_ROOTCERT_FILE": str(RUNTIME / "organizations" / slug / "node/tls/ca.crt"),
        "CORE_PEER_TLS_SERVERHOSTOVERRIDE": f"peer0.{slug}.battery.local",
    })
    return env


def channel():
    block = RUNTIME / f"{CHANNEL}.block"
    if block.exists():
        raise RuntimeError("Channel block exists; inspect partial state before retrying")
    for port in (17050, 17053, *PORTS.values()):
        wait_tcp(port)
    # Configuration is public and regenerated from retained MSPs; keys and existing ledgers stay intact.
    (RUNTIME / "configtx.yaml").write_text(json.dumps(configtx(),indent=2)+"\n")
    env = dict(os.environ,FABRIC_CFG_PATH=str(RUNTIME))
    run([fabric_bin("configtxgen"),"-profile","BatteryChannel","-channelID",CHANNEL,"-outputBlock",block],env=env)
    tls = RUNTIME / "organizations/orderer/node/tls"
    run([fabric_bin("osnadmin"),"channel","join","--channelID",CHANNEL,"--config-block",block,"-o","localhost:17053","--ca-file",tls / "ca.crt","--client-cert",tls / "server.crt","--client-key",tls / "server.key"])
    for slug in ORGANIZATIONS:
        run([fabric_bin("peer"),"channel","join","-b",block],env=peer_environment(slug))


def deploy(version="1.0",sequence=1):
    import re
    if not re.fullmatch(r"[0-9]+\.[0-9]+",version) or sequence<1:raise RuntimeError("Invalid deployment version or sequence")
    package = RUNTIME / f"battery_{version}.tar.gz"
    env = peer_environment("cell")
    peer = fabric_bin("peer")
    if package.exists():
        with tarfile.open(package) as outer:
            with tarfile.open(fileobj=io.BytesIO(outer.extractfile("code.tar.gz").read())) as inner:
                for member in inner.getmembers():
                    if member.isfile() and member.name.startswith("src/"):
                        relative = Path(member.name).relative_to("src")
                        if ".." in relative.parts or (ROOT / "chaincode" / relative).read_bytes() != inner.extractfile(member).read():
                            raise RuntimeError("Existing package differs from current source; refusing stale deployment")
    else:
        run([peer,"lifecycle","chaincode","package",package,"--path",ROOT / "chaincode","--lang","golang","--label",f"battery_{version}"],env=env)
    package_id = run([peer,"lifecycle","chaincode","calculatepackageid",package],env=env,capture=True)
    tls = RUNTIME / "organizations/orderer/node/tls/ca.crt"
    orderer = ["-o","localhost:17050","--ordererTLSHostnameOverride","orderer.battery.local","--tls","--cafile",tls]
    definition = ["--channelID",CHANNEL,"--name","battery","--version",version,"--sequence",str(sequence),"--signature-policy","OutOf(3,'CellOrgMSP.peer','PackOrgMSP.peer','LabOrgMSP.peer','RecycleOrgMSP.peer')"]
    for slug in ORGANIZATIONS:
        env = peer_environment(slug)
        installed = json.loads(run([peer,"lifecycle","chaincode","queryinstalled","--output","json"],env=env,capture=True))
        if not any(item.get("package_id")==package_id for item in installed.get("installed_chaincodes",[])):
            run([peer,"lifecycle","chaincode","install",package],env=env)
        readiness = json.loads(run([peer,"lifecycle","chaincode","checkcommitreadiness",*definition,"--output","json"],env=env,capture=True))
        if not readiness.get("approvals",{}).get(ORGANIZATIONS[slug]):
            run([peer,"lifecycle","chaincode","approveformyorg",*orderer,*definition,"--package-id",package_id],env=env)
    ready = json.loads(run([peer,"lifecycle","chaincode","checkcommitreadiness",*definition,"--output","json"],env=env,capture=True))
    if any(not ready.get("approvals",{}).get(msp) for msp in ORGANIZATIONS.values()):
        raise RuntimeError("Not all business organizations approved the definition")
    targets=[]
    for slug in ORGANIZATIONS:
        targets += ["--peerAddresses",f"localhost:{PORTS[slug]}","--tlsRootCertFiles",str(RUNTIME / "organizations" / slug / "node/tls/ca.crt")]
    commit_env=dict(env)
    # All explicitly supplied peer certificates include localhost; one per-org override
    # cannot be reused for a multi-peer CLI call. TLS root and SAN verification stay enabled.
    commit_env.pop("CORE_PEER_TLS_SERVERHOSTOVERRIDE",None)
    run([peer,"lifecycle","chaincode","commit",*orderer,*definition,*targets],env=commit_env)
    evidence = {"network":"local","channel":CHANNEL,"chaincode":"battery","version":version,"sequence":sequence,"packageId":package_id,"organizations":{}}
    for slug in ORGANIZATIONS:
        committed = json.loads(run([peer,"lifecycle","chaincode","querycommitted","--channelID",CHANNEL,"--name","battery","--output","json"],env=peer_environment(slug),capture=True))
        if committed.get("sequence") != sequence or committed.get("version") != version:
            raise RuntimeError("Committed chaincode definition mismatch")
        evidence["organizations"][ORGANIZATIONS[slug]] = committed
    evidence_text = json.dumps(evidence, indent=2) + "\n"
    (RUNTIME / f"deployment-{version}.json").write_text(evidence_text)
    (ROOT / f"docs/reports/business-chaincode-deployment-{version}.json").write_text(evidence_text)
    print("Business chaincode definition verified on all four local peers")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action",choices=["prepare","up","up-fabric","up-storage","channel","deploy","resume","status"])
    parser.add_argument("--version",default="1.0")
    parser.add_argument("--sequence",type=int,default=1)
    args=parser.parse_args()
    if args.action=="prepare":generate()
    elif args.action=="up":up()
    elif args.action=="up-fabric":up(False)
    elif args.action=="up-storage":run([DOCKER,"compose","-p",PROJECT,"-f","-","up","-d","minio"],data=(RUNTIME / "compose.json").read_bytes())
    elif args.action=="channel":channel()
    elif args.action=="deploy":deploy(args.version,args.sequence)
    elif args.action=="resume":run([DOCKER,"compose","-p",PROJECT,"-f","-","start"],data=(RUNTIME / "compose.json").read_bytes())
    elif args.action=="status":run([DOCKER,"ps","--filter",f"label=com.docker.compose.project={PROJECT}","--format","{{.Names}} {{.Status}} {{.Ports}}"])


if __name__=="__main__":main()
