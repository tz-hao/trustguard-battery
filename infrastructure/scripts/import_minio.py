#!/usr/bin/env python3
"""Import the locally built, pinned official MinIO static binary; no registry push."""
import hashlib
import io
import json
import subprocess
import tarfile

from business_network import ROOT, DOCKER, run

IMAGE = "trustguard/minio:2025-10-15"
REVISION = "9e49d5e7a648"


def main():
    binary = ROOT / ".tools/bin/minio"
    if "statically linked" not in subprocess.check_output(["file",str(binary)],text=True):
        raise RuntimeError("Static MinIO binary required")
    existing = run([DOCKER,"images","--format","{{.Repository}}:{{.Tag}}"],capture=True).splitlines()
    if IMAGE in existing:
        revision = run([DOCKER,"image","inspect",IMAGE,"--format",'{{index .Config.Labels "org.opencontainers.image.revision"}}'],capture=True)
        if revision != REVISION:
            raise RuntimeError("Existing image tag has another revision; refusing to overwrite")
        print("Pinned local MinIO image already exists")
        return
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive,mode="w") as stream:
        info=stream.gettarinfo(str(binary),arcname="minio")
        info.uid=info.gid=0;info.uname=info.gname="";info.mode=0o755
        with binary.open("rb") as data:stream.addfile(info,data)
        for name,mode in [("data",0o700),("tmp",0o1777)]:
            item=tarfile.TarInfo(name);item.type=tarfile.DIRTYPE;item.mode=mode;stream.addfile(item)
    image_id=run([DOCKER,"import","--platform","linux/amd64","--change",'ENTRYPOINT ["/minio"]',
        "--change",f"LABEL org.opencontainers.image.source=https://github.com/minio/minio", "--change",f"LABEL org.opencontainers.image.revision={REVISION}","-",IMAGE],data=archive.getvalue(),capture=True)
    report={"network":"local","image":IMAGE,"imageId":image_id,"source":"https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z",
            "revision":REVISION,"binarySha256":hashlib.sha256(binary.read_bytes()).hexdigest(),"static":True,
            "note":"Community source repository is archived. This pinned development build is not a production support claim."}
    (ROOT / "docs/reports/minio-local-build.json").write_text(json.dumps(report,indent=2)+"\n")
    print("Imported pinned MinIO static binary into project-owned local image")


if __name__=="__main__":main()
