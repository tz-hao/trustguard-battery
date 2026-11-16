import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['apps/web', 'services/api', 'services/risk', 'chaincode', 'infrastructure', 'datasets', 'tests', 'docs']) {
  assert(existsSync(path.join(root, dir)), `Missing ${dir}`);
}
assert.equal(process.version, 'v22.23.1');
assert.equal(execFileSync(path.join(root, '.tools/go1.26.4/bin/go'), ['version'], { encoding: 'utf8' }).trim(), 'go version go1.26.4 linux/amd64');
assert.match(execFileSync(path.join(root, '.venv/bin/python'), ['--version'], { encoding: 'utf8' }), /Python 3\.12\.3/);
assert.match(execFileSync('/home/milli/projects/fabric-samples/bin/peer', ['version'], { encoding: 'utf8' }), /Version: v2\.5\.16/);
assert.match(execFileSync(path.join(root, 'node_modules/.bin/next'), ['--version'], { encoding: 'utf8' }), /16\.4\.6/);
await import('@hyperledger/fabric-gateway');
await import('@grpc/grpc-js');
console.log('PASS: project directories, Node, Go, Python venv, Fabric CLI, Next.js and Gateway SDK');
