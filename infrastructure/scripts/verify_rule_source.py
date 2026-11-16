#!/usr/bin/env python3
"""Read-only comparison of executed policy-test rules with the deployed code package."""
import argparse
import hashlib
import io
import json
import re
import tarfile

from toolchain import ROOT, RUNTIME

GO_FILES = [str(file.relative_to(ROOT / 'chaincode')) for file in (ROOT / 'chaincode').rglob('*.go') if 'vendor' not in file.relative_to(ROOT / 'chaincode').parts]
PRODUCTION = [file for file in GO_FILES if not file.endswith('_test.go')] + ['go.mod', 'go.sum']
TESTS = [file for file in GO_FILES if file.endswith('_test.go')]


def digest(files):
    value = hashlib.sha256()
    for name in sorted(files):
        value.update(name.encode() + b"\0" + (ROOT / 'chaincode' / name).read_bytes() + b"\0")
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    parser.add_argument('--sequence', type=int, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9]+\.[0-9]+', args.version) or args.sequence < 1:
        raise RuntimeError('INVALID_DEFINITION')
    runtime_record = RUNTIME / f'deployment-{args.version}.json'
    report_record = ROOT / f'docs/reports/business-chaincode-deployment-{args.version}.json'
    record_file = runtime_record if runtime_record.exists() else report_record
    record = json.loads(record_file.read_text())
    if record['version'] != args.version or record['sequence'] != args.sequence:
        raise RuntimeError('DEFINITION_MISMATCH')
    with tarfile.open(RUNTIME / f'battery_{args.version}.tar.gz') as outer:
        with tarfile.open(fileobj=io.BytesIO(outer.extractfile('code.tar.gz').read())) as source:
            for name in PRODUCTION:
                if source.extractfile('src/' + name).read() != (ROOT / 'chaincode' / name).read_bytes():
                    raise RuntimeError('RULE_SOURCE_MISMATCH')
    print(json.dumps({
        'verified': True,
        'version': args.version,
        'sequence': str(args.sequence),
        'packageId': record['packageId'],
        'ruleSourceHash': digest(PRODUCTION),
        'testSourceHash': digest(TESTS),
    }))


if __name__ == '__main__':
    main()
