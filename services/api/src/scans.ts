import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedActor } from './types.js';
import type { FabricService } from './gateway.js';
import type { Database } from './database.js';

const inputSchema = z.object({code: z.string().regex(/^[A-Z0-9]{24}$/), requestId: z.string().uuid()}).strict();
// Fixed simulated checkpoints. Clients do not submit coordinates, station IDs or clocks.
const sites = { CellOrgMSP: '电芯厂', PackOrgMSP: '装配厂', LabOrgMSP: '检测站', RecycleOrgMSP: '回收站' };
const projection = 's.code, s.site, s.observed_at AS "observedAt", p.site AS "previousSite", p.observed_at AS "previousAt"';
export class ScanService {
  constructor(private db: Database, private fabric: FabricService) {}
  async record(actor: AuthenticatedActor, body: unknown) {
    const {code, requestId} = inputSchema.parse(body);
    if (!['manufacturer','assembler','inspector','custodian','operator','recycler'].includes(actor.identity.role))
      throw new HttpException({code:'FORBIDDEN'},403);
    await this.fabric.query(actor.identity, 'battery', code);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(41,hashtext($1))',[actor.actorHash + requestId]);
      const existing = await client.query('SELECT code FROM scan_observations WHERE actor_hash=$1 AND request_id=$2',[actor.actorHash,requestId]);
      if (existing.rows.length && existing.rows[0].code !== code) throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);
      if (!existing.rows.length) {
        await client.query('SELECT pg_advisory_xact_lock(42,hashtext($1))',[code]);
        await client.query(`INSERT INTO scan_observations(code,site,actor_hash,request_id,conflict_with)
          VALUES($1::varchar(24),$2::text,$3,$4,(SELECT id FROM scan_observations WHERE code=$1::varchar(24) AND site<>$2::text
            AND observed_at >= clock_timestamp()-interval '10 minutes' ORDER BY observed_at DESC,id DESC LIMIT 1))`,
          [code,sites[actor.identity.mspId],actor.actorHash,requestId]);
      }
      const result = await client.query(`SELECT ${projection} FROM scan_observations s LEFT JOIN scan_observations p ON p.id=s.conflict_with
        WHERE s.actor_hash=$1 AND s.request_id=$2`,[actor.actorHash,requestId]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }
  async recent(actor: AuthenticatedActor, code: string) {
    if (!['auditor','inspector','custodian','manufacturer','assembler','operator','recycler'].includes(actor.identity.role))
      throw new HttpException({code:'FORBIDDEN'},403);
    await this.fabric.query(actor.identity,'battery',code);
    const allSites = actor.identity.role === 'auditor';
    const {rows} = await this.db.pool.query(`SELECT ${projection} FROM scan_observations s LEFT JOIN scan_observations p ON p.id=s.conflict_with
      WHERE s.code=$1 AND ($2 OR s.site=$3) ORDER BY s.observed_at DESC,s.id DESC LIMIT 20`,[code,allSites,sites[actor.identity.mspId]]);
    return rows;
  }
}
