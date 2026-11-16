#!/usr/bin/env python3
"""One-command cold-start bootstrap (or safe resume if runtime already exists)."""
from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import subprocess
import time
import urllib.request
from pathlib import Path

from business_network import PORTS, PROJECT, channel, deploy, generate, up
from toolchain import DOCKER, ROOT, RUNTIME, resolve_node, resolve_python


def run_step(cmd: list[str], *, env=None, cwd: Path = ROOT):
    subprocess.run(cmd, env=env, cwd=cwd, check=True)


def wait_container_healthy(name: str, timeout_seconds: int = 90):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            status = subprocess.check_output(
                [DOCKER, "inspect", name, "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=10,
            ).strip()
            if status in ("healthy", "running"):
                return
        except Exception:
            pass
        time.sleep(1.0)
    raise RuntimeError(f"Container {name} did not become healthy within {timeout_seconds}s")


def wait_ports(ports: list[int], timeout_seconds: int = 60):
    deadline = time.monotonic() + timeout_seconds
    pending = set(ports)
    while pending and time.monotonic() < deadline:
        for port in list(pending):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                    pending.remove(port)
            except OSError:
                pass
        if pending:
            time.sleep(0.5)
    if pending:
        raise RuntimeError(f"Ports not ready within {timeout_seconds}s: {sorted(pending)}")


def wait_api_ready(timeout_seconds: int = 45):
    ca_file = RUNTIME / "server-ca/ca.crt"
    cert_file = RUNTIME / "organizations/cell/users/viewer/api.crt"
    key_file = RUNTIME / "organizations/cell/users/viewer/api.key"
    ctx = ssl.create_default_context(cafile=str(ca_file))
    ctx.load_cert_chain(certfile=str(cert_file), keyfile=str(key_file))
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request("https://localhost:13000/api/v1/health", method="GET")
            with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
                if resp.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("API did not become ready at https://localhost:13000/api/v1/health")


def wait_web_ready(timeout_seconds: int = 45):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:3100/api/bff/session", timeout=5) as resp:
                if resp.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("Web UI did not become ready at http://127.0.0.1:3100")


def ensure_builds():
    node_bin = resolve_node()
    env = dict(os.environ)
    env["PATH"] = str(Path(node_bin).parent) + os.pathsep + env.get("PATH", "")
    npm_cmd = "npm"
    if not (ROOT / "services/api/dist/main.js").exists():
        print("== Building @trustguard/api ==")
        run_step([npm_cmd, "run", "build", "--workspace", "@trustguard/api"], env=env)
    if not (ROOT / "apps/web/.next/BUILD_ID").exists():
        print("== Building @trustguard/web ==")
        run_step([npm_cmd, "run", "build", "--workspace", "@trustguard/web"], env=env)


def main():
    parser = argparse.ArgumentParser(description="Initialize or resume the local TrustGuard Battery environment.")
    parser.add_argument("--no-demo", action="store_true", help="Skip initial simulated demo dataset & attack verification")
    parser.add_argument("--version", default="1.3", help="Chaincode version to deploy on fresh init (default: 1.3)")
    parser.add_argument("--sequence", type=int, default=1, help="Chaincode sequence on fresh init (default: 1)")
    args = parser.parse_args()

    python_bin = resolve_python()
    services_script = str(ROOT / "infrastructure/scripts/business_services.py")
    network_script = str(ROOT / "infrastructure/scripts/business_network.py")

    ensure_builds()

    if RUNTIME.exists():
        print("Existing runtime detected at infrastructure/runtime/business/; resuming without modifying certificates or ledger.")
        if (RUNTIME / "compose.json").exists():
            run_step([python_bin, network_script, "resume"])
        wait_container_healthy("tg-battery-postgres")
        wait_ports([15432, 19000, 17050, *PORTS.values()])
        run_step([python_bin, services_script, "start"])
        wait_api_ready()
        wait_web_ready()
        print("\nTrustGuard Battery is running at http://127.0.0.1:3100")
        return

    print("== 1/8 Checking/importing MinIO image ==")
    if not os.environ.get("TRUSTGUARD_MINIO_IMAGE"):
        run_step([python_bin, str(ROOT / "infrastructure/scripts/import_minio.py")])

    print("== 2/8 Generating independent 4-org MSPs, TLS CAs and service configuration ==")
    generate()

    print("== 3/8 Starting Fabric Peers, Orderer, PostgreSQL and MinIO containers ==")
    up(include_storage=True)
    wait_container_healthy("tg-battery-postgres")
    wait_ports([15432, 19000, 17050, 17053, *PORTS.values()])

    print("== 4/8 Creating and joining channel 'batterybusiness' ==")
    channel()

    print(f"== 5/8 Packaging, installing and committing chaincode 'battery' {args.version} (seq {args.sequence}) ==")
    deploy(args.version, args.sequence)

    print("== 6/8 Generating simulated quality references and source signing keys ==")
    run_step([python_bin, services_script, "references"])
    run_step([python_bin, services_script, "sources"])

    print("== 7/8 Running DB migrations, creating S3 bucket and initializing ledger policy ==")
    run_step([python_bin, services_script, "bootstrap"])

    print("== 8/8 Starting Risk, Key Broker, API, Indexer, Audit Worker and Web UI ==")
    run_step([python_bin, services_script, "start"])
    wait_api_ready()
    wait_web_ready()

    if not args.no_demo:
        print("== Seeding initial simulated demo data (makers, batteries, inspections, attacks A1-A8) ==")
        run_step([python_bin, services_script, "verify", "--check", "demo"])

    print("\n============================================================")
    print("TrustGuard Battery local platform is READY!")
    print("  Web Workbench : http://127.0.0.1:3100")
    print("  mTLS API      : https://localhost:13000/api/v1/health")
    print("  Docker stack  :", PROJECT)
    print("============================================================")


if __name__ == "__main__":
    main()
