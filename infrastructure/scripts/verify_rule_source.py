#!/usr/bin/env python3
"""Verify deployed rule sources and optionally prepare a pinned local test directory."""
import argparse
import hashlib
import io
import json
import re
import tarfile
from pathlib import PurePosixPath

from toolchain import ROOT, RUNTIME

def digest(files):
    value = hashlib.sha256()
    for name, data in sorted(files.items()):
        value.update(name.encode() + b"\0" + data + b"\0")
    return value.hexdigest()


def prepare_directory(package_hash, files):
    # WSL/server only. Readers see a complete, verified tree even after an interrupted first run.
    import fcntl
    parent = RUNTIME / 'verified-rules'
    parent.mkdir(mode=0o700, exist_ok=True)
    target = parent / package_hash
    with (parent / '.prepare.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target.mkdir(mode=0o700, exist_ok=True)
        if target.is_symlink() or any(p.is_symlink() or (p.is_file() and p.relative_to(target).as_posix() not in files)
                                      for p in target.rglob('*')):
            raise RuntimeError('UNEXPECTED_TEST_FILE')
        for name, data in files.items():
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not path.exists():
                # The lock serializes this staging file. Interrupted writes never enter the tree.
                staging = parent / '.preparing-file'
                staging.write_bytes(data)
                staging.replace(path)
            if path.read_bytes() != data:
                raise RuntimeError('CACHED_RULE_SOURCE_MISMATCH')
    return str(target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    parser.add_argument('--sequence', type=int, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--package-proof', action='store_true', help='read the deployment package independently of the checkout')
    mode.add_argument('--prepare-tests', action='store_true', help='populate the local version-specific test directory')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9]+\.[0-9]+', args.version) or args.sequence < 1:
        raise RuntimeError('INVALID_DEFINITION')
    runtime_record = RUNTIME / f'deployment-{args.version}.json'
    report_record = ROOT / f'docs/reports/business-chaincode-deployment-{args.version}.json'
    record_file = runtime_record if runtime_record.exists() else report_record
    record = json.loads(record_file.read_text())
    if record['version'] != args.version or record['sequence'] != args.sequence:
        raise RuntimeError('DEFINITION_MISMATCH')
    archive = (RUNTIME / f'battery_{args.version}.tar.gz').read_bytes()
    package_hash = hashlib.sha256(archive).hexdigest()
    with tarfile.open(fileobj=io.BytesIO(archive)) as outer:
        label = json.load(outer.extractfile('metadata.json'))['label']
        if record['packageId'] != f'{label}:{package_hash}':
            raise RuntimeError('PACKAGE_ID_MISMATCH')
        files = {}
        with tarfile.open(fileobj=io.BytesIO(outer.extractfile('code.tar.gz').read())) as source:
            for member in source:
                if member.isdir():
                    continue
                p = PurePosixPath(member.name)
                if not member.isfile() or p.parts[:1] != ('src',) or '..' in p.parts or len(p.parts) < 2:
                    raise RuntimeError('INVALID_RULE_PACKAGE')
                name = p.relative_to('src').as_posix()
                if name in files:
                    raise RuntimeError('DUPLICATE_RULE_FILE')
                files[name] = source.extractfile(member).read()
    rules = {k:v for k,v in files.items() if not k.startswith('vendor/') and
             (k.endswith('.go') or k in ('go.mod', 'go.sum'))}
    tests = {k:v for k,v in rules.items() if k.endswith('_test.go')}
    if not tests or not {'go.mod','go.sum','main.go'} <= rules.keys():
        raise RuntimeError('INCOMPLETE_RULE_PACKAGE')
    if not (args.package_proof or args.prepare_tests):
        working = ROOT / 'chaincode'
        names = {p.relative_to(working).as_posix() for p in working.rglob('*.go') if 'vendor' not in p.relative_to(working).parts} | {'go.mod','go.sum'}
        if names != rules.keys() or any((working / name).read_bytes() != data for name,data in rules.items()):
            raise RuntimeError('RULE_SOURCE_MISMATCH')
    proof = {
        'verified': True,
        'version': args.version,
        'sequence': str(args.sequence),
        'packageId': record['packageId'],
        'ruleSourceHash': digest({k:v for k,v in rules.items() if k not in tests}),
        'testSourceHash': digest(tests),
    }
    if args.package_proof or args.prepare_tests:
        fixtures = {}
        if any(b'../../apps/web/public/examples/mes-' in data for data in tests.values()):
            for step in ('production', 'pack-products', 'supply', 'assembly'):
                name = f'apps/web/public/examples/mes-{step}.json'
                fixtures[name] = (ROOT / name).read_bytes()
        proof['testFixtureHash'] = digest(fixtures)
        if args.prepare_tests:
            tree = {**{'chaincode/' + name:data for name,data in files.items()}, **fixtures}
            directory = prepare_directory(package_hash + '-' + proof['testFixtureHash'], tree)
            proof['testDirectory'] = directory + '/chaincode'
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
