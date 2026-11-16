import { readFileSync } from 'node:fs';
import { X509Certificate, createHash } from 'node:crypto';
import { z } from 'zod';
import { organizations, type ClientIdentity } from './types.js';

const identitySchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/),
  mspId: z.enum(organizations),
  role: z.enum(['admin', 'manufacturer', 'inspector', 'assembler', 'approver', 'release', 'custodian', 'operator', 'recycler', 'auditor', 'viewer']),
  clientFingerprint: z.string().regex(/^[A-F0-9:]{95}$/),
  certificateFile: z.string().min(1), privateKeyFile: z.string().min(1),
  gatewayEndpoint: z.string().regex(/^(localhost|127\.0\.0\.1):[0-9]{1,5}$/),
  gatewayServerName: z.string().min(1), gatewayTlsRootFile: z.string().min(1),
}).strict();

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export interface Configuration {
  channel: string; chaincode: string; databaseUrl: string; port: number;
  tls: { cert: Buffer; key: Buffer; ca: Buffer; crl?: Buffer; requestCert: true; rejectUnauthorized: true; minVersion: 'TLSv1.2' };
  identities: ClientIdentity[];
}

export function loadConfiguration(): Configuration {
  const identities = z.array(identitySchema).min(4).parse(JSON.parse(readFileSync(requiredEnv('TRUSTGUARD_IDENTITIES_FILE'), 'utf8')));
  const seen = new Set<string>();
  const names = new Set<string>();
  const signers = new Set<string>();
  for (const identity of identities) {
    if (seen.has(identity.clientFingerprint)) throw new Error('Duplicate client certificate mapping');
    seen.add(identity.clientFingerprint);
    // Read and parse certificates at startup, never report contents or paths in HTTP responses.
    const signer = new X509Certificate(readFileSync(identity.certificateFile)).fingerprint256;
    if (names.has(identity.name) || signers.has(signer)) throw new Error('Each API identity must have a unique Fabric signer and name');
    names.add(identity.name); signers.add(signer);
  }
  for (const msp of organizations) if (!identities.some(i => i.mspId === msp)) throw new Error(`Missing organization: ${msp}`);
  const crlFile = requiredEnv('TRUSTGUARD_CLIENT_CRL_FILE');
  const port = Number(process.env.TRUSTGUARD_API_PORT ?? 13000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API port');
  return {
    channel: process.env.TRUSTGUARD_CHANNEL ?? 'batterybusiness',
    chaincode: process.env.TRUSTGUARD_CHAINCODE ?? 'battery',
    databaseUrl: requiredEnv('TRUSTGUARD_DATABASE_URL'), port, identities,
    tls: {
      cert: readFileSync(requiredEnv('TRUSTGUARD_TLS_CERT')),
      key: readFileSync(requiredEnv('TRUSTGUARD_TLS_KEY')),
      ca: readFileSync(requiredEnv('TRUSTGUARD_CLIENT_CA_FILE')),
      crl: readFileSync(crlFile), requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2',
    },
  };
}

export function fingerprint(bytes: Buffer): string { return new X509Certificate(bytes).fingerprint256; }
export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
