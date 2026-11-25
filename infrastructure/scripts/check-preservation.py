#!/usr/bin/env python3
"""Read-only comparison against the pre-setup Docker and service baseline (original dev host only)."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
docker = str(root / 'infrastructure/scripts/docker-local.sh')
parser = argparse.ArgumentParser()
parser.add_argument('--report', default='docs/reports/final-preservation-check.json')
args = parser.parse_args()

baseline_file = root / 'docs/reports/docker-baseline.json'
if not baseline_file.exists():
    print('SKIP: docs/reports/docker-baseline.json not present (baseline check only applies to original dev host).')
    raise SystemExit(0)


def output(cmd_args):
    return subprocess.check_output([docker, *cmd_args], timeout=25).decode().strip()


baseline = json.loads(baseline_file.read_text())
containers = []
for previous in baseline['containers']:
    template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"state":{{json .State}},"mounts":{{json .Mounts}},"restartPolicy":{{json .HostConfig.RestartPolicy}}}'
    current = json.loads(output(['inspect', previous['name'], '--format', template]))
    state = current.pop('state')
    current.update(status=state['Status'], health=state.get('Health', {}).get('Status'))
    for field in ('id', 'name', 'image', 'status', 'mounts', 'restartPolicy', 'health'):
        assert current[field] == previous[field], (previous['name'], field)
    containers.append(current)
initial_images = {json.loads(line)['ID'] for line in baseline['images'].splitlines() if line.strip()}
assert initial_images <= set(output(['image', 'ls', '--no-trunc', '--format', '{{.ID}}']).splitlines())
initial_volumes = {json.loads(line)['Name'] for line in baseline['volumes'].splitlines() if line.strip()}
current_volumes = set(output(['volume', 'ls', '--format', '{{.Name}}']).splitlines())
assert initial_volumes <= current_volumes
services = []
for service, pid in baseline['protectedServicePids'].items():
    values = subprocess.check_output(['systemctl', '--user', 'show', service, '-p', 'ActiveState', '-p', 'MainPID']).decode()
    fields = dict(line.split('=', 1) for line in values.splitlines())
    assert fields['ActiveState'] == 'active'
    assert int(fields['MainPID']) == pid
    services.append({'service': service, 'state': 'active', 'pid': pid})
shared_node_link = baseline.get('sharedNodeSymlink')
if shared_node_link:
    assert Path(shared_node_link['link']).resolve() == Path(shared_node_link['target'])
result = {'result': 'PASS', 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'baselineContainers': containers, 'allInitialImageIdsPreserved': True, 'allInitialVolumesPreserved': True,
    'protectedServices': services, 'sharedNodeSymlinkPreserved': True,
    'nativeWslDockerSocketExists': Path('/var/run/docker.sock').exists(),
    'projectContainers': output(['ps', '-a', '--filter', 'label=com.docker.compose.project=trustguard-battery-fabric',
                                '--format', '{{.Names}} | {{.Status}} | {{.Ports}}']),
    'fabricImageDigests': output(['image', 'ls', '--digests', '--filter', 'reference=ghcr.io/hyperledger/fabric-*',
                                 '--format', '{{.Repository}}:{{.Tag}} {{.Digest}}']),
    'volumes': sorted(current_volumes)}
(root / args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print('PASS: original containers/images/volumes, Hermes/proxy PIDs and shared Node preserved')
print(result['projectContainers'])
