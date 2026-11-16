#!/usr/bin/env python3
"""Start the official test-network topology with local Engine volumes.

No down/reset/cleanup path. Never replace existing crypto or config volumes.
Docker Desktop's native WSL integration is not required for file bind mounts.
"""
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = Path('/home/milli/projects/fabric-samples')
NET = SAMPLES / 'test-network'
DOCKER = str(ROOT / 'infrastructure/scripts/docker-local.sh')
PROJECT = 'trustguard-battery-fabric'
NETWORK = 'trustguard_battery_fabric'
VERSION = '2.5.16'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def capture(args, **kwargs):
    return subprocess.check_output(args, **kwargs).decode().strip()


def main():
    env = dict(os.environ, DOCKER_SOCK='/var/run/docker.sock')
    names = set(capture([DOCKER, 'ps', '-a', '--format', '{{.Names}}']).splitlines())
    wanted = {'orderer.example.com', 'peer0.org1.example.com', 'peer0.org2.example.com'}
    if names & wanted:
        raise SystemExit('Existing Fabric container names found; inspect and reuse explicitly. No changes made.')
    if capture([DOCKER, 'network', 'ls', '--filter', f'name=^{NETWORK}$', '--format', '{{.Name}}']):
        raise SystemExit('Project network already exists; refusing automatic recreation.')
    # Preserve all pre-existing certificates, even a partial previous initialization.
    for name in ('peerOrganizations', 'ordererOrganizations'):
        if (NET / 'organizations' / name).exists():
            raise SystemExit(f'Existing {name}; refusing to regenerate certificates.')
    for org in ('org1', 'org2', 'orderer'):
        run([str(SAMPLES / 'bin/cryptogen'), 'generate',
             f'--config=./organizations/cryptogen/crypto-config-{org}.yaml',
             '--output=organizations'], cwd=NET)
    run(['bash', 'organizations/ccp-generate.sh'], cwd=NET)
    config = json.loads(capture(['docker', 'compose', '-p', PROJECT,
        '-f', 'compose/compose-test-net.yaml',
        '-f', 'compose/docker/docker-compose-test-net.yaml',
        'config', '--format', 'json'], cwd=NET, env=env))
    config['networks']['test']['name'] = NETWORK
    mappings = {}
    for service_name, service in config['services'].items():
        service['image'] = f'ghcr.io/hyperledger/fabric-{"orderer" if service_name.startswith("orderer") else "peer"}:{VERSION}'
        service.pop('labels', None)  # Compose adds the project ownership label.
        for port in service.get('ports', []):
            port['host_ip'] = '127.0.0.1'
        variables = service['environment']
        if service_name.startswith('peer'):
            variables['CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE'] = NETWORK
            variables['CORE_CHAINCODE_BUILDER'] = f'ghcr.io/hyperledger/fabric-ccenv:{VERSION}'
            variables['CORE_CHAINCODE_GOLANG_RUNTIME'] = f'ghcr.io/hyperledger/fabric-baseos:{VERSION}'
        for mount in service['volumes']:
            if mount['type'] != 'bind' or mount['target'] == '/host/var/run/docker.sock':
                continue
            source = Path(mount['source'])
            if not source.is_dir():
                raise SystemExit(f'Missing official source directory: {source}')
            if source not in mappings:
                mappings[source] = f'cfg{len(mappings)+1}'
            key = mappings[source]
            mount.clear()
            mount.update(type='volume', source=key,
                         target=('/etc/hyperledger/peercfg' if source.name == 'peercfg'
                                 else '/var/hyperledger/orderer/msp' if source.name == 'msp'
                                 else '/var/hyperledger/orderer/tls' if source.name == 'tls'
                                 else '/etc/hyperledger/fabric'), read_only=True)
            config['volumes'][key] = {'name': f'{PROJECT}_{key}'}
    # Fail before populating any volume if one already exists.
    existing = set(capture([DOCKER, 'volume', 'ls', '--format', '{{.Name}}']).splitlines())
    for key in mappings.values():
        if f'{PROJECT}_{key}' in existing:
            raise SystemExit(f'Existing config volume {key}; refusing to overwrite.')
    for source, key in mappings.items():
        volume = f'{PROJECT}_{key}'
        run([DOCKER, 'volume', 'create', '--label', f'com.docker.compose.project={PROJECT}',
             '--label', f'com.docker.compose.volume={key}', volume], stdout=subprocess.DEVNULL)
        helper = f'trustguard-seed-{key}'
        run([DOCKER, 'create', '--name', helper, '--network', 'none',
             '--mount', f'type=volume,source={volume},target=/target',
             '--entrypoint', '/bin/true', 'postgres:16-alpine'], stdout=subprocess.DEVNULL)
        # Crypto goes only into this local Engine, via an in-memory tar stream.
        # Never print, persist a second tar archive, or transmit it off-machine.
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as stream:
            for child in source.iterdir():
                stream.add(child, arcname=child.name)
        run([DOCKER, 'cp', '-', f'{helper}:/target'], input=archive.getvalue(),
            stdout=subprocess.DEVNULL)
        # Exact newly-created, stopped helper only; no containers from the baseline.
        run([DOCKER, 'rm', helper], stdout=subprocess.DEVNULL)
        print(f'Initialized project volume {volume}', flush=True)
    config['name'] = PROJECT
    runtime = ROOT / 'infrastructure/runtime'
    runtime.mkdir(exist_ok=True)
    (runtime / 'fabric-compose.json').write_text(json.dumps(config, indent=2) + '\n')
    run([DOCKER, 'compose', '-p', PROJECT, '-f', '-', 'up', '-d'],
        input=json.dumps(config).encode())
    print('Started official test-network topology using project-owned configuration volumes.')


if __name__ == '__main__':
    main()
