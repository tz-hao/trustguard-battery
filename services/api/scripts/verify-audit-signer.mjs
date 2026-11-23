import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { auditSigner } from '../dist/audit-identity.js';

const runtime = path.resolve(import.meta.dirname, '../../../infrastructure/runtime');
const business = JSON.parse(await readFile(path.join(runtime, 'business/identities.json'), 'utf8'));
const auditDirectory = path.join(runtime, 'audit-peer-demo/users/auditor/msp');
const signer = await auditSigner(business, auditDirectory);
assert.equal(signer.mspId, 'AuditOrgMSP');
assert.equal(signer.role, 'auditor');
assert(!business.some(i => i.mspId === signer.mspId || i.certificateFile === signer.certificateFile));
assert.equal((await auditSigner(business)).name, 'lab-auditor');
await assert.rejects(auditSigner(business, path.join(runtime, 'business/organizations/lab/users/auditor/msp')), /AUDIT_CA_MUST_BE_INDEPENDENT/);
await assert.rejects(auditSigner(business, ''), /ABSOLUTE_AUDIT_MSP_REQUIRED/);
console.log('Independent audit signer and separate CA verified. Public registry contains four business MSPs.');
