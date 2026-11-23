import { createServer } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { reportSubject } from './report-subject.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { KeyVault } from './key-vault.js';
import { requiredEnv, type Configuration } from './config.js';
import { verifyPermit } from './cryptography.js';
import type { ClientIdentity } from './types.js';

const permitSchema = z.object({ claims: z.object({
  reportId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/), actorMSP: z.string().max(96),
  actorRole: z.string().max(96), nonce: z.string().uuid(), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict(), signature: z.string().max(256) }).strict();

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new Error('BODY_TOO_LARGE');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString());
}

async function main() {
  const identity = JSON.parse(readFileSync(requiredEnv('TRUSTGUARD_BROKER_IDENTITY_FILE'), 'utf8')) as ClientIdentity;
  const config = { channel: process.env.TRUSTGUARD_CHANNEL ?? 'batterybusiness', chaincode: 'battery', identities: [identity] } as Configuration;
  const fabric = new FabricService(config);
  const database = new Database(requiredEnv('TRUSTGUARD_BROKER_DATABASE_URL'));
  const vault = new KeyVault(requiredEnv('TRUSTGUARD_VAULT_DIRECTORY'), readFileSync(requiredEnv('TRUSTGUARD_MASTER_KEY_FILE')));
  const permitPublicKey = createPublicKey(readFileSync(requiredEnv('TRUSTGUARD_PERMIT_PUBLIC_KEY_FILE')));
  if (permitPublicKey.asymmetricKeyType !== 'ed25519') throw new Error('INVALID_GATEWAY_PERMIT_PUBLIC_KEY');
  const used = new Map<string, number>();
  const server = createServer({
    cert: readFileSync(requiredEnv('TRUSTGUARD_BROKER_TLS_CERT')), key: readFileSync(requiredEnv('TRUSTGUARD_BROKER_TLS_KEY')),
    ca: readFileSync(requiredEnv('TRUSTGUARD_GATEWAY_CLIENT_CA')), crl: readFileSync(requiredEnv('TRUSTGUARD_GATEWAY_CLIENT_CRL')),
    requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2',
  }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED');
      const body = await jsonBody(request);
      let key: Buffer;
      if (request.url === '/keys/create') {
        const { reportId } = z.object({ reportId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/) }).strict().parse(body);
        key = await vault.create(reportId);
      } else if (request.url === '/keys/open') {
        const permit = permitSchema.parse(body);
        const now = Date.now();
        for (const [nonce, expires] of used) if (expires <= now) used.delete(nonce);
        if (used.size > 10000 || used.has(permit.claims.nonce) || !verifyPermit(permit.claims, permit.signature, permitPublicKey, now)) throw new Error('INVALID_PERMIT');
        used.set(permit.claims.nonce, Date.parse(permit.claims.expiresAt));
        const { rows } = await database.pool.query<{asset_id: string; owner_msp: string}>(`SELECT asset_id,owner_msp FROM reports WHERE id=$1`, [permit.claims.reportId]);
        const row = rows[0];
        if (!row) throw new Error('REPORT_NOT_FOUND');
        // Independent fresh ledger check, rather than relying on the API's permission result.
        const asset = await reportSubject(fabric,identity,row.asset_id);
        if (!['inspector', 'manufacturer', 'custodian', 'operator', 'auditor'].includes(permit.claims.actorRole)
          || permit.claims.actorMSP !== row.owner_msp && permit.claims.actorMSP !== asset.holderMSP) throw new Error('FORBIDDEN');
        const denied = await database.pool.query(`SELECT 1 FROM report_grants WHERE report_id=$1 AND grantee_msp=$2 AND (revoked_at IS NOT NULL OR expires_at<=now())`, [permit.claims.reportId, permit.claims.actorMSP]);
        if (denied.rowCount) throw new Error('FORBIDDEN');
        key = await vault.open(permit.claims.reportId);
      } else { response.writeHead(404); response.end('{"code":"NOT_FOUND"}'); return; }
      try { response.writeHead(200); response.end(JSON.stringify({ key: key.toString('base64') })); }
      finally { key.fill(0); }
    } catch {
      response.writeHead(403); response.end('{"code":"KEY_ACCESS_DENIED"}');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(18001, '127.0.0.1', () => console.log('Local mTLS key broker ready'));
  const close = () => { server.close(() => { void fabric.close().then(() => database.close()); }); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
main().catch(() => { console.error('Key broker startup failed: verify local certificates, master key and database'); process.exitCode = 1; });
