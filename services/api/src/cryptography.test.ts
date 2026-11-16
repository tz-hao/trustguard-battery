import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { encryptReport, decryptReport, signPermit, verifyPermit } from './cryptography.js';
import { sha256 } from './config.js';

test('AEAD roundtrip over different binary sizes; nonce uniqueness', () => {
  const nonces = new Set<string>();
  for (const size of [0, 1, 15, 16, 17, 255, 1024, 65536]) {
    const plaintext = randomBytes(size), key = randomBytes(32);
    const binding = { id: 'report-1', assetId: 'cell-1', plaintextHash: sha256(plaintext), version: 1 };
    const encrypted = encryptReport(plaintext, key, binding);
    assert.deepEqual(decryptReport(encrypted, key, binding), plaintext);
    assert(!nonces.has(encrypted.nonce)); nonces.add(encrypted.nonce);
  }
});
test('tampering with bytes, binding, auth tag or key cannot yield plaintext', () => {
  const plaintext = Buffer.from('simulated confidential report'), key = randomBytes(32);
  const binding = { id: 'report-1', assetId: 'cell-1', plaintextHash: sha256(plaintext), version: 1 };
  const encrypted = encryptReport(plaintext, key, binding);
  const changed = Buffer.from(encrypted.ciphertext); changed[0] ^= 1;
  assert.throws(() => decryptReport({ ...encrypted, ciphertext: changed }, key, binding));
  assert.throws(() => decryptReport(encrypted, key, { ...binding, assetId: 'another-cell' }));
  assert.throws(() => decryptReport(encrypted, randomBytes(32), binding));
  assert.throws(() => decryptReport({ ...encrypted, authTag: randomBytes(16).toString('base64') }, key, binding));
});
test('key permit binds target, identity and expiration', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const claims = { reportId: 'r1', actorMSP: 'LabOrgMSP', actorRole: 'inspector', nonce: 'one-use', issuedAt: '2026-11-15T12:00:00Z', expiresAt: '2026-11-15T12:00:30Z' };
  const permit = signPermit(claims, privateKey);
  const now = Date.parse('2026-11-15T12:00:01Z');
  assert(verifyPermit(claims, permit.signature, publicKey, now));
  assert(!verifyPermit({ ...claims, reportId: 'r2' }, permit.signature, publicKey, now));
  assert(!verifyPermit(claims, permit.signature, publicKey, now + 30000));
  assert(!verifyPermit({ ...claims, expiresAt: '2026-11-15T12:02:00Z' }, permit.signature, publicKey, now));
});
