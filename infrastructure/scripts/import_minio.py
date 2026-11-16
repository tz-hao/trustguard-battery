#!/usr/bin/env python3
"""Import (or build from pinned source) the official MinIO static binary; no registry push."""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

from business_network import run
from toolchain import DOCKER, ROOT, docker_arch, resolve_go

IMAGE = "trustguard/minio:2025-10-15"
TAG = "RELEASE.2025-10-15T17-29-55Z"
REVISION = "9e49d5e7a648"
SOURCE_URL = f"https://github.com/minio/minio/archive/refs/tags/{TAG}.tar.gz"


def is_static_linux_binary(binary: Path) -> bool:
    if not binary.is_file():
        return False
    with binary.open("rb") as stream:
        if stream.read(4) != b"\x7fELF":
            return False
    if shutil.which("file"):
        output = subprocess.check_output(["file", str(binary)], text=True)
        return "static" in output
    return True


def build_static_binary(binary: Path, arch: str):
    binary.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="trustguard-minio-") as tmp:
        tmp_dir = Path(tmp)
        archive_path = tmp_dir / "minio.tar.gz"
        print(f"Downloading MinIO {TAG} source archive...")
        urllib.request.urlretrieve(SOURCE_URL, archive_path)
        with tarfile.open(archive_path, "r:gz") as tf:
            tf.extractall(tmp_dir, filter="data")
        src_dir = tmp_dir / f"minio-{TAG}"
        if not src_dir.is_dir():
            candidates = [p for p in tmp_dir.iterdir() if p.is_dir()]
            if not candidates:
                raise RuntimeError("Extracted MinIO source directory not found")
            src_dir = candidates[0]
        ldflags = f"-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.ShortCommitID={REVISION}"
        try:
            go_bin = resolve_go()
            env = dict(os.environ)
            env.update({
                "CGO_ENABLED": "0",
                "GOOS": "linux",
                "GOARCH": arch,
                "GOPATH": str(ROOT / ".tools/gopath"),
                "GOCACHE": str(ROOT / ".tools/go-build"),
            })
            print(f"Building static MinIO binary (linux/{arch}) with {go_bin}...")
            subprocess.run([go_bin, "build", "-trimpath", "-ldflags", ldflags, "-o", str(binary), "."], cwd=src_dir, env=env, check=True)
        except Exception as exc:
            print(f"Local Go build skipped/failed ({exc}); falling back to Docker golang:1.25-alpine builder...")
            subprocess.run([
                DOCKER, "run", "--rm", "--platform", f"linux/{arch}",
                "-v", f"{src_dir}:/src", "-v", f"{binary.parent}:/out",
                "-w", "/src", "-e", "CGO_ENABLED=0", "-e", "GOOS=linux", "-e", f"GOARCH={arch}",
                "golang:1.25-alpine",
                "go", "build", "-trimpath", "-ldflags", ldflags, "-o", f"/out/{binary.name}", ".",
            ], check=True)
    binary.chmod(0o755)


def main():
    existing = run([DOCKER, "images", "--format", "{{.Repository}}:{{.Tag}}"], capture=True).splitlines()
    if IMAGE in existing:
        revision = run([DOCKER, "image", "inspect", IMAGE, "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}'], capture=True)
        if revision != REVISION:
            raise RuntimeError("Existing image tag has another revision; refusing to overwrite")
        print("Pinned local MinIO image already exists")
        return

    arch = docker_arch()
    binary = ROOT / ".tools/bin/minio"
    if not binary.exists():
        build_static_binary(binary, arch)
    if not is_static_linux_binary(binary):
        raise RuntimeError("Static Linux ELF MinIO binary required")

    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w") as stream:
        info = stream.gettarinfo(str(binary), arcname="minio")
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mode = 0o755
        with binary.open("rb") as data:
            stream.addfile(info, data)
        for name, mode in [("data", 0o700), ("tmp", 0o1777)]:
            item = tarfile.TarInfo(name)
            item.type = tarfile.DIRTYPE
            item.mode = mode
            stream.addfile(item)

    image_id = run(
        [
            DOCKER, "import", "--platform", f"linux/{arch}",
            "--change", 'ENTRYPOINT ["/minio"]',
            "--change", "LABEL org.opencontainers.image.source=https://github.com/minio/minio",
            "--change", f"LABEL org.opencontainers.image.revision={REVISION}",
            "-", IMAGE,
        ],
        data=archive.getvalue(),
        capture=True,
    )
    report = {
        "network": "local",
        "image": IMAGE,
        "platform": f"linux/{arch}",
        "imageId": image_id,
        "source": f"https://github.com/minio/minio/releases/tag/{TAG}",
        "revision": REVISION,
        "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "static": True,
        "note": "Community source repository is archived. This pinned development build is not a production support claim.",
    }
    (ROOT / "docs/reports/minio-local-build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Imported pinned MinIO static binary into project-owned local image")


if __name__ == "__main__":
    main()
