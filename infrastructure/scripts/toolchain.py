"""Shared cross-platform toolchain and path discovery for TrustGuard scripts."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "infrastructure/runtime/business"
DOCKER = str(ROOT / "infrastructure/scripts/docker-local.sh")


def resolve_fabric_root(require_test_network: bool = False) -> Path | None:
    candidates: list[Path] = []
    if env_val := os.environ.get("FABRIC_SAMPLES"):
        candidates.append(Path(env_val))
    if not require_test_network:
        candidates.append(ROOT / ".tools/fabric")
    candidates.extend([
        ROOT / ".tools/fabric-samples",
        ROOT.parent / "fabric-samples",
        Path.home() / "fabric-samples",
    ])
    for candidate in candidates:
        if require_test_network:
            if (candidate / "test-network").is_dir() and (candidate / "bin/peer").exists():
                return candidate
        else:
            if (candidate / "config/core.yaml").exists() and (candidate / "bin/peer").exists():
                return candidate
    return None


def fabric_bin(name: str) -> str:
    fabric_root = resolve_fabric_root()
    if fabric_root and (fabric_root / "bin" / name).exists():
        return str(fabric_root / "bin" / name)
    if found := shutil.which(name):
        return found
    raise RuntimeError(
        f"Fabric binary '{name}' not found. Run ./infrastructure/scripts/setup.sh "
        "or set FABRIC_SAMPLES to your fabric-samples directory."
    )


def fabric_config_dir() -> Path:
    if env_cfg := os.environ.get("FABRIC_CFG_PATH"):
        path = Path(env_cfg)
        if (path / "core.yaml").exists():
            return path
    fabric_root = resolve_fabric_root()
    if fabric_root and (fabric_root / "config/core.yaml").exists():
        return fabric_root / "config"
    raise RuntimeError(
        "Fabric config/core.yaml not found. Run ./infrastructure/scripts/setup.sh "
        "or set FABRIC_SAMPLES / FABRIC_CFG_PATH."
    )


def resolve_go() -> str:
    candidates = [
        os.environ.get("TRUSTGUARD_GO_BIN"),
        str(ROOT / ".tools/go1.26.4/bin/go"),
        str(ROOT / ".tools/go/bin/go"),
        shutil.which("go"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise RuntimeError(
        "Go toolchain not found. Run ./infrastructure/scripts/setup.sh "
        "or install Go >= 1.26.4 in PATH."
    )


def resolve_node() -> str:
    candidates = [
        os.environ.get("TRUSTGUARD_NODE_BIN"),
        shutil.which("node"),
        str(ROOT / ".tools/node/bin/node"),
        str(Path.home() / ".local/bin/node"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise RuntimeError(
        "Node.js not found. Install Node.js 22.x in PATH or set TRUSTGUARD_NODE_BIN."
    )


def resolve_python() -> str:
    candidates = [
        os.environ.get("TRUSTGUARD_PYTHON_BIN"),
        str(ROOT / ".venv/bin/python"),
        sys.executable,
        shutil.which("python3"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise RuntimeError(
        "Python 3.12 not found. Run ./infrastructure/scripts/setup.sh "
        "or set TRUSTGUARD_PYTHON_BIN."
    )


def resolve_next_bin() -> Path:
    for candidate in (
        ROOT / "node_modules/next/dist/bin/next",
        ROOT / "apps/web/node_modules/next/dist/bin/next",
    ):
        if candidate.exists():
            return candidate
    raise RuntimeError("Next.js binary not found. Run 'npm ci' at repository root.")


def docker_arch() -> str:
    raw = ""
    try:
        raw = subprocess.check_output(
            [DOCKER, "info", "--format", "{{.Architecture}}"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=10,
        ).strip().lower()
    except Exception:
        raw = platform.machine().lower()
    if raw in ("x86_64", "amd64"):
        return "amd64"
    if raw in ("aarch64", "arm64"):
        return "arm64"
    return raw or "amd64"
