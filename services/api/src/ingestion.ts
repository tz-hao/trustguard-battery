import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { InternalClient } from './internal-client.js';
import { canonicalJson, sha256 } from './config.js';
import type { Asset, AuthenticatedActor } from './types.js';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
const schema = z.object({ requestId: id, sourceId: id, batchId: id, issuedAt: z.string().max(30),
  contentBase64: z.string().max(6_000_000), signature: z.string().max(256) }).strict();
interface ImportedMeasurement { asset_id: string; batch_id: string; chemistry: string; model: string; [key: string]: unknown }

export class IngestionService {
  constructor(private readonly db: Database, private readonly fabric: FabricService, private readonly internal: InternalClient) {}
  async csv(actor: AuthenticatedActor, body: unknown) {
    if (actor.identity.mspId !== 'LabOrgMSP' || actor.identity.role !== 'inspector') throw new HttpException({ code: 'FORBIDDEN' }, 403);
    const { requestId, ...input } = schema.parse(body);
    const hash = sha256(canonicalJson(input));
    const previous=await this.db.pool.query('SELECT payload_hash,result FROM import_receipts WHERE actor_hash=$1 AND request_id=$2',[actor.actorHash,requestId]);
    if(previous.rows[0]){if(previous.rows[0].payload_hash!==hash)throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);return previous.rows[0].result;}
    const imported = await this.internal.post<{ sourceHash: string; measurements: ImportedMeasurement[] }>(process.env.TRUSTGUARD_RISK_URL ?? 'https://localhost:18000', '/ingestion/csv', input);
    for (const row of imported.measurements) {
      const asset = await this.fabric.query<Asset>(actor.identity, 'asset', row.asset_id);
      if (asset.type !== 'CELL' || asset.batchId !== row.batch_id || asset.chemistry !== row.chemistry || asset.model !== row.model || asset.simulation !== row.simulation) throw new HttpException({ code: 'MEASUREMENT_ASSET_MISMATCH' }, 400);
    }
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [actor.actorHash + ':' + requestId]);
      const existing = await client.query('SELECT payload_hash,result FROM import_receipts WHERE actor_hash=$1 AND request_id=$2', [actor.actorHash,requestId]);
      if (existing.rows[0]) {
        if (existing.rows[0].payload_hash !== hash) throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);
        await client.query('COMMIT'); return existing.rows[0].result;
      }
      for (const row of imported.measurements) await client.query(`INSERT INTO measurements(source_hash,asset_id,batch_id,body) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT DO NOTHING`,[imported.sourceHash,row.asset_id,row.batch_id,JSON.stringify(row)]);
      const result = { requestId, sourceHash: imported.sourceHash, records: imported.measurements.length, imported: true, ledgerAnchored: false };
      await client.query('INSERT INTO import_receipts(actor_hash,request_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)',[actor.actorHash,requestId,hash,JSON.stringify(result)]);
      await client.query('COMMIT');return result;
    } catch (error) { await client.query('ROLLBACK');throw error; }
    finally { client.release(); }
  }
}
