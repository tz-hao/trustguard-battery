#!/usr/bin/env python3
"""Run only this project's application processes using private local configuration."""
import argparse
import json
import os
import subprocess
import signal
import time
from pathlib import Path

from business_network import ROOT, RUNTIME


def environment():
    env = dict(os.environ)
    env.update(json.loads((RUNTIME / "service-environment.json").read_text()))
    env["PYTHONPATH"] = str(ROOT / "services/risk")
    return env


def references():
    import sys
    sys.path.insert(0,str(ROOT / "services/risk"))
    from trustguard_risk.datasets import generate
    target = RUNTIME / "quality-reference.json"
    if target.exists():
        print("Existing explicit simulated reference set retained")
        return
    target.write_text(json.dumps([row.model_dump() for row in generate()[0]]))
    print("Prepared 600 explicit simulated quality reference records")


def sources():
    import base64
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from business_certificates import save_key, write
    key_file=RUNTIME / "services/source-signing.key"
    if not key_file.exists():save_key(key_file,Ed25519PrivateKey.generate())
    key=serialization.load_pem_private_key(key_file.read_bytes(),password=None)
    registry={"lab-source":base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)).decode()}
    registry_file=RUNTIME / "services/source-keys.json"
    if not registry_file.exists():write(registry_file,json.dumps(registry).encode())
    elif json.loads(registry_file.read_text())!=registry:raise RuntimeError("Existing source registry mismatch")
    env_file=RUNTIME / "service-environment.json"
    env=json.loads(env_file.read_text());env["TRUSTGUARD_SOURCE_KEYS_FILE"]=str(registry_file)
    env_file.write_text(json.dumps(env,indent=2)+"\n")
    print("Local source signer and public registry verified")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=["references","sources","bootstrap","start","restart","stop","status","verify"])
    parser.add_argument("--service",choices=["risk","broker","api","indexer","audit","web"])
    parser.add_argument("--check",choices=["demo","health","policy","index","security","concurrency","corrections","audit","idempotency","codes"],default="demo")
    args=parser.parse_args()
    if args.action=="stop" and not args.service:raise RuntimeError("Stopping requires one explicit project service")
    if args.action=="references":references();return
    if args.action=="sources":sources();return
    env=environment()
    node="/home/milli/.hermes/profiles/englishbot/node/bin/node"
    if args.action=="verify":
        script="demo-business.mjs" if args.check=="demo" else f"verify-{args.check}.mjs"
        subprocess.run([node,str(ROOT / "services/api/scripts" / script)],env=env,cwd=ROOT,check=True)
        return
    if args.action=="bootstrap":
        subprocess.run([node,str(ROOT / "services/api/scripts/bootstrap-business.mjs")],env=env,cwd=ROOT,check=True)
        return
    process_file=RUNTIME / "processes.json"
    processes=json.loads(process_file.read_text()) if process_file.exists() else {}
    commands={"risk":[str(ROOT / ".venv/bin/python"),"-m","trustguard_risk.server"],
              "broker":[node,str(ROOT / "services/api/dist/key-broker.js")],
              "api":[node,str(ROOT / "services/api/dist/main.js")],
              "indexer":[node,str(ROOT / "services/api/dist/index-worker.js")],
              "audit":[node,str(ROOT / "services/api/dist/audit-worker.js")],
              "web":[node,str(ROOT / "node_modules/next/dist/bin/next"),"start","-H","127.0.0.1","-p","3100"]}
    for service,command in commands.items():
        if args.service and args.service!=service:continue
        previous=processes.get(service,{})
        pid=previous.get("pid")
        alive=False
        if pid and (Path("/proc") / str(pid) / "cmdline").exists():
            actual=(Path("/proc") / str(pid) / "cmdline").read_bytes().split(b"\0")
            alive=all(arg.encode() in actual for arg in command)
        if args.action=="status":
            print(f"{service}: {'running' if alive else 'not visible in current process namespace; verify via mTLS'}")
            continue
        if args.action in ["restart","stop"] and alive:
            os.kill(pid,signal.SIGTERM)
            for _ in range(100):
                entry=Path("/proc") / str(pid) / "cmdline"
                if not entry.exists() or not entry.read_bytes():break
                time.sleep(.1)
            else:raise RuntimeError("Project process did not stop; refusing duplicate start")
            alive=False
        if args.action=="stop":
            print(f"{service}: project process stopped" if pid else f"{service}: no project process recorded")
            continue
        if alive:
            print(f"{service}: existing project process retained")
            continue
        service_env=dict(env)
        if service=="risk":
            service_env["TRUSTGUARD_TLS_CERT"]=str(RUNTIME / "services/risk.crt")
            service_env["TRUSTGUARD_TLS_KEY"]=str(RUNTIME / "services/risk.key")
        log=RUNTIME / f"{service}.log"
        cwd=ROOT / "apps/web" if service=="web" else ROOT
        with log.open("ab") as output:
            child=subprocess.Popen(command,env=service_env,cwd=cwd,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        processes[service]={"pid":child.pid,"log":str(log)}
        process_file.write_text(json.dumps(processes,indent=2)+"\n")
        print(f"{service}: project process started")


if __name__=="__main__":main()
