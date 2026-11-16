import { createCipheriv, createDecipheriv, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalJson, sha256 } from './config.js';

export interface ReportBinding { id: string; assetId: string; plaintextHash: string; version: number }
export interface EncryptedReport { ciphertext: Buffer; nonce: string; authTag: string; ciphertextHash: string }
export function encryptReport(plaintext: Buffer, dataKey: Buffer, binding: ReportBinding): EncryptedReport {
  if (dataKey.length !== 32 || sha256(plaintext) !== binding.plaintextHash) throw new Error('INVALID_REPORT_KEY_OR_HASH');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
  cipher.setAAD(Buffer.from(canonicalJson(binding)));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertextHash: sha256(ciphertext) };
}
export function decryptReport(encrypted: EncryptedReport, dataKey: Buffer, binding: ReportBinding): Buffer {
  if (sha256(encrypted.ciphertext) !== encrypted.ciphertextHash) throw new Error('REPORT_INTEGRITY_FAILED');
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(encrypted.nonce, 'base64'));
  decipher.setAAD(Buffer.from(canonicalJson(binding)));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  if (sha256(plaintext) !== binding.plaintextHash) { plaintext.fill(0); throw new Error('REPORT_INTEGRITY_FAILED'); }
  return plaintext;
}
export interface KeyPermit { reportId: string; actorMSP: string; actorRole: string; nonce: string; issuedAt: string; expiresAt: string }
export function signPermit(claims: KeyPermit, key: KeyObject): { claims: KeyPermit; signature: string } {
  return { claims, signature: sign(null, Buffer.from(canonicalJson(claims)), key).toString('base64') };
}
export function verifyPermit(claims: KeyPermit, signature: string, publicKey: KeyObject, now = Date.now()): boolean {
  const issued = Date.parse(claims.issuedAt), expires = Date.parse(claims.expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && expires > now && expires - issued <= 30000
    && verify(null, Buffer.from(canonicalJson(claims)), publicKey, Buffer.from(signature, 'base64'));
}
