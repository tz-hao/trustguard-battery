import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['apps/web', 'services/api', 'services/risk', 'chaincode', 'infrastructure', 'datasets', 'tests', 'docs']) {
  assert(existsSync(path.join(root, dir)), `Missing ${dir}`);
}

function firstExisting(candidates, fallback) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return fallback;
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
assert.equal(nodeMajor, 22, `Expected Node.js v22.x, got ${process.version}`);

const goBin = firstExisting(
  [process.env.TRUSTGUARD_GO_BIN, path.join(root, '.tools/go1.26.4/bin/go'), path.join(root, '.tools/go/bin/go')],
  'go',
);
assert.match(execFileSync(goBin, ['version'], { encoding: 'utf8' }), /go version go1\.(2[6-9]|[3-9]\d)\./);

const pythonBin = firstExisting([process.env.TRUSTGUARD_PYTHON_BIN, path.join(root, '.venv/bin/python')], 'python3');
assert.match(execFileSync(pythonBin, ['--version'], { encoding: 'utf8' }), /Python 3\.12\.\d+/);

const peerBin = firstExisting(
  [
    process.env.FABRIC_SAMPLES ? path.join(process.env.FABRIC_SAMPLES, 'bin/peer') : '',
    path.join(root, '.tools/fabric/bin/peer'),
    path.join(root, '.tools/fabric-samples/bin/peer'),
    path.resolve(root, '../fabric-samples/bin/peer'),
    path.join(homedir(), 'fabric-samples/bin/peer'),
  ],
  'peer',
);
assert.match(execFileSync(peerBin, ['version'], { encoding: 'utf8' }), /Version: v2\.5\.\d+/);

const nextBin = firstExisting(
  [path.join(root, 'node_modules/.bin/next'), path.join(root, 'apps/web/node_modules/.bin/next')],
  'next',
);
assert.match(execFileSync(nextBin, ['--version'], { encoding: 'utf8' }), /16\.4\.\d+/);

await import('@hyperledger/fabric-gateway');
await import('@grpc/grpc-js');
console.log('PASS: project directories, Node 22.x, Go, Python 3.12, Fabric 2.5 CLI, Next.js and Gateway SDK');
