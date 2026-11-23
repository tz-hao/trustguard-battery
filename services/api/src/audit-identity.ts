import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BusinessIdentity, ClientIdentity } from './types.js';

// Only the worker reads this MSP. Public mTLS sessions remain limited to the business registry.
export async function auditSigner(identities: BusinessIdentity[], mspDirectory?: string): Promise<ClientIdentity> {
  if (mspDirectory === undefined) {
    const legacy = identities.find(i => i.name === 'lab-auditor' && i.mspId === 'LabOrgMSP' && i.role === 'auditor');
    if (!legacy) throw new Error('AUDIT_IDENTITY_REQUIRED');
    return legacy;
  }
  const gateway = identities[0];
  if (!gateway) throw new Error('AUDIT_GATEWAY_REQUIRED');
  if (!path.isAbsolute(mspDirectory)) throw new Error('ABSOLUTE_AUDIT_MSP_REQUIRED');
  const certificateFile = path.join(mspDirectory, 'signcerts/cert.pem');
  const privateKeyFile = path.join(mspDirectory, 'keystore/key.pem');
  const cert = new X509Certificate(await readFile(certificateFile));
  const issuer = new X509Certificate(await readFile(path.join(mspDirectory, 'cacerts/ca.pem')));
  if (!issuer.ca || !cert.checkIssued(issuer) || !cert.verify(issuer.publicKey) ||
      Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo)) throw new Error('INVALID_AUDIT_SIGNER');
  for (const identity of identities) {
    const businessCert = new X509Certificate(await readFile(identity.certificateFile));
    if (businessCert.verify(issuer.publicKey)) throw new Error('AUDIT_CA_MUST_BE_INDEPENDENT');
  }
  if (!cert.checkPrivateKey(createPrivateKey(await readFile(privateKeyFile)))) throw new Error('INVALID_AUDIT_SIGNER');
  return { ...gateway, name: 'audit-auditor', mspId: 'AuditOrgMSP', role: 'auditor',
    certificateFile, privateKeyFile, clientFingerprint: cert.fingerprint256 };
}
