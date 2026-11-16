#!/usr/bin/env python3
"""Start existing project containers without regenerating crypto or changing volumes."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
project = 'trustguard-battery-fabric'
docker = str(root / 'infrastructure/scripts/docker-local.sh')
manifest = (root / 'infrastructure/runtime/fabric-compose.json').read_bytes()
assert json.loads(manifest)['name'] == project
for container in ('orderer.example.com', 'peer0.org1.example.com', 'peer0.org2.example.com'):
    owner = subprocess.check_output([docker, 'inspect', container, '--format',
        '{{index .Config.Labels "com.docker.compose.project"}}']).decode().strip()
    if owner != project:
        raise SystemExit(f'{container} is not owned by this project; refusing to start.')
subprocess.run([docker, 'compose', '-p', project, '-f', '-', 'start'], input=manifest, check=True)
