import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, requiredEnv, sha256 } from './config.js';
import { Database } from './database.js';

export class AuditService {
  private readonly key: KeyObject;
  constructor(private readonly db: Database) {
    this.key = createPrivateKey(readFileSync(requiredEnv('TRUSTGUARD_AUDIT_KEY_FILE')));
    if (this.key.asymmetricKeyType !== 'ed25519') throw new Error('Audit signing key must be Ed25519');
  }
  async record(actorHash: string, requestId: string | null, action: string, outcome: string) {
    const issuedAt=new Date().toISOString();
    const digest = sha256(canonicalJson({ actorHash, requestId, action, outcome,issuedAt }));
    const signature = sign(null, Buffer.from(digest, 'hex'), this.key).toString('base64');
    await this.db.pool.query(`INSERT INTO security_logs(actor_hash,request_id,action,outcome,evidence_hash,signature,created_at,signature_version) VALUES($1,$2,$3,$4,$5,$6,$7,2)`,
      [actorHash, requestId, action, outcome, digest, signature,issuedAt]);
  }
}
