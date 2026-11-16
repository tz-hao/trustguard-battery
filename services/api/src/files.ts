import { createPrivateKey, verify, X509Certificate, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { canonicalJson, requiredEnv, sha256 } from './config.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { InternalClient } from './internal-client.js';
import { encryptReport, decryptReport, signPermit } from './cryptography.js';
import type { Asset, AuthenticatedActor } from './types.js';

const uploadSchema = z.object({
  requestId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),
  assetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),
  version: z.number().int().min(1).max(1_000_000),
  contentBase64: z.string().min(4).max(6_000_000), plaintextHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSignature: z.string().min(1).max(4096),
}).strict();
interface ReportRow {
  id: string; asset_id: string; owner_msp: string; plaintext_hash: string; ciphertext_hash: string;
  object_key: string; key_reference: string; nonce: string; auth_tag: string; version: number;
  request_id:string;source_hash:string;signer_fingerprint:string;
}

export class FileService {
  private readonly client: S3Client;
  private readonly bucket = requiredEnv('TRUSTGUARD_REPORT_BUCKET');
  private readonly permitKey = createPrivateKey(readFileSync(requiredEnv('TRUSTGUARD_PERMIT_KEY_FILE')));
  constructor(private readonly db: Database, private readonly fabric: FabricService, private readonly internal: InternalClient) {
    const endpoint = new URL(requiredEnv('TRUSTGUARD_S3_ENDPOINT'));
    if (!['localhost', '127.0.0.1'].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error('LOCAL_S3_ENDPOINT_REQUIRED');
    const credentials = z.object({ accessKeyId: z.string(), secretAccessKey: z.string() }).strict().parse(JSON.parse(readFileSync(requiredEnv('TRUSTGUARD_S3_CREDENTIALS_FILE'), 'utf8')));
    this.client = new S3Client({ endpoint: endpoint.href, region: 'us-east-1', forcePathStyle: true, credentials, maxAttempts: 1 });
    if (this.permitKey.asymmetricKeyType !== 'ed25519') throw new Error('INVALID_PERMIT_SIGNER');
  }
  async check() { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
  async upload(actor: AuthenticatedActor, body: unknown) {
    if (actor.identity.mspId !== 'LabOrgMSP' || actor.identity.role !== 'inspector') throw new HttpException({ code: 'FORBIDDEN' }, 403);
    const input = uploadSchema.parse(body);
    const plaintext = Buffer.from(input.contentBase64, 'base64');
    if (plaintext.length > 4 * 1024 * 1024 || plaintext.toString('base64') !== input.contentBase64 || sha256(plaintext) !== input.plaintextHash) throw new HttpException({ code: 'REPORT_HASH_MISMATCH' }, 400);
    const binding = { id: input.id, assetId: input.assetId, plaintextHash: input.plaintextHash, version: input.version };
    const certificate = new X509Certificate(readFileSync(actor.identity.certificateFile));
    if (!verify('sha256', Buffer.from(canonicalJson(binding)), certificate.publicKey, Buffer.from(input.sourceSignature, 'base64'))) throw new HttpException({ code: 'SOURCE_SIGNATURE_INVALID' }, 400);
    const sourceHash = sha256(canonicalJson(binding));
    const existing = await this.db.pool.query<ReportRow>('SELECT * FROM reports WHERE id=$1 OR (signer_fingerprint=$2 AND request_id=$3)', [input.id,certificate.fingerprint256,input.requestId]);
    if(existing.rowCount){
      const row=existing.rows[0];
      if(existing.rowCount!==1||row.id!==input.id||row.request_id!==input.requestId||row.signer_fingerprint!==certificate.fingerprint256||row.asset_id!==input.assetId||row.version!==input.version||row.plaintext_hash!==input.plaintextHash||row.source_hash!==sourceHash)throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);
      return {requestId:row.request_id,id:row.id,assetId:row.asset_id,version:row.version,hash:row.plaintext_hash,sourceHash:row.source_hash,stored:true,ledgerAnchored:false};
    }
    const asset = await this.fabric.query<Asset>(actor.identity, 'asset', input.assetId);
    if (input.version !== asset.inspectionVersion + 1) throw new HttpException({ code: 'VERSION_CONFLICT' }, 409);
    const created = await this.internal.post<{ key: string }>(process.env.TRUSTGUARD_KEY_URL ?? 'https://localhost:18001', '/keys/create', { reportId: input.id });
    const key = Buffer.from(created.key, 'base64');
    try {
      const encrypted = encryptReport(plaintext, key, binding);
      const objectKey = `reports/${input.id}/${randomUUID()}`;
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: encrypted.ciphertext, ContentType: 'application/octet-stream' }));
      await this.db.pool.query(`INSERT INTO reports(id,asset_id,owner_msp,plaintext_hash,ciphertext_hash,object_key,key_reference,nonce,auth_tag,version,source_hash,source_signature,signer_fingerprint,request_id) VALUES($1,$2,$3,$4,$5,$6,$1,$7,$8,$9,$10,$11,$12,$13)`,
        [input.id, input.assetId, actor.identity.mspId, input.plaintextHash, encrypted.ciphertextHash, objectKey, encrypted.nonce, encrypted.authTag, input.version, sourceHash, input.sourceSignature, certificate.fingerprint256,input.requestId]);
      return {requestId:input.requestId, id: input.id, assetId: input.assetId, version: input.version, hash: input.plaintextHash, sourceHash, stored: true, ledgerAnchored: false };
    } finally { key.fill(0); plaintext.fill(0); }
  }
  async download(actor: AuthenticatedActor, id: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(id)) throw new HttpException({ code: 'INVALID_ID' }, 400);
    const { rows } = await this.db.pool.query<ReportRow>('SELECT * FROM reports WHERE id=$1', [id]);
    const row = rows[0];
    if (!row) throw new HttpException({ code: 'NOT_FOUND' }, 404);
    const asset = await this.fabric.query<Asset>(actor.identity, 'asset', row.asset_id);
    const allowedRole = ['inspector', 'manufacturer', 'custodian', 'operator', 'auditor'].includes(actor.identity.role);
    if (!allowedRole || actor.identity.mspId !== row.owner_msp && actor.identity.mspId !== asset.holderMSP) throw new HttpException({ code: 'FORBIDDEN' }, 403);
    const revoked = await this.db.pool.query('SELECT 1 FROM report_grants WHERE report_id=$1 AND grantee_msp=$2 AND (revoked_at IS NOT NULL OR expires_at<=now())', [id, actor.identity.mspId]);
    if (revoked.rowCount) throw new HttpException({ code: 'REPORT_ACCESS_REVOKED' }, 403);
    const now = new Date();
    const permit = signPermit({ reportId: id, actorMSP: actor.identity.mspId, actorRole: actor.identity.role, nonce: randomUUID(), issuedAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 15000).toISOString() }, this.permitKey);
    const opened = await this.internal.post<{ key: string }>(process.env.TRUSTGUARD_KEY_URL ?? 'https://localhost:18001', '/keys/open', permit);
    const key = Buffer.from(opened.key, 'base64');
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: row.object_key }));
      if (!object.Body || !object.ContentLength || object.ContentLength > 4 * 1024 * 1024) throw new Error('INVALID_REPORT_OBJECT');
      const ciphertext = Buffer.from(await object.Body.transformToByteArray());
      return decryptReport({ ciphertext, nonce: row.nonce, authTag: row.auth_tag, ciphertextHash: row.ciphertext_hash }, key,
        { id: row.id, assetId: row.asset_id, plaintextHash: row.plaintext_hash, version: row.version });
    } finally { key.fill(0); }
  }
  async revoke(actor: AuthenticatedActor, id: string, targetMSP: string,requestId:string) {
    if (actor.identity.role !== 'inspector') throw new HttpException({ code: 'FORBIDDEN' }, 403);
    const { rows } = await this.db.pool.query<ReportRow>('SELECT * FROM reports WHERE id=$1 AND owner_msp=$2', [id, actor.identity.mspId]);
    if (!rows[0]) throw new HttpException({ code: 'FORBIDDEN' }, 403);
    const hash=sha256(canonicalJson({kind:'report-revocation',id,targetMSP})),client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[actor.actorHash+':'+requestId]);
      const prior=await client.query('SELECT payload_hash,result FROM import_receipts WHERE actor_hash=$1 AND request_id=$2',[actor.actorHash,requestId]);
      if(prior.rows[0]){if(prior.rows[0].payload_hash!==hash)throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);await client.query('COMMIT');return prior.rows[0].result;}
      await client.query(`INSERT INTO report_grants(report_id,grantee_msp,expires_at,revoked_at) VALUES($1,$2,now(),now())
        ON CONFLICT(report_id,grantee_msp) DO UPDATE SET revoked_at=COALESCE(report_grants.revoked_at,excluded.revoked_at)`,[id,targetMSP]);
      const result={requestId,revoked:true};
      await client.query('INSERT INTO import_receipts(actor_hash,request_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)',[actor.actorHash,requestId,hash,JSON.stringify(result)]);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async verifyInspection(actor: AuthenticatedActor, data: Record<string, unknown>) {
    const { rows } = await this.db.pool.query('SELECT asset_id,version,plaintext_hash,source_hash FROM reports WHERE id=$1 AND owner_msp=$2', [data.id, actor.identity.mspId]);
    const row = rows[0];
    if (!row || row.asset_id !== data.assetId || row.version !== data.version || row.plaintext_hash !== data.reportHash || row.source_hash !== data.sourceHash) throw new HttpException({ code: 'VERIFIED_REPORT_REQUIRED' }, 400);
  }
  close() { this.client.destroy(); }
}
