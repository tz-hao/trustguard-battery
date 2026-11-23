import { Database } from './database.js';
import { aiError } from './deepseek.js';

export interface AiRow {
  actor_hash: string; request_id: string; asset_id: string; payload_hash: string;
  state: 'running' | 'completed' | 'failed'; result: Record<string, unknown> | null;
  error_code: string | null; created_at: Date;
}
export interface AnalysisStore {
  get(actor: string, request: string): Promise<AiRow | undefined>;
  reserve(actor: string, request: string, asset: string, digest: string): Promise<boolean>;
  complete(actor: string, request: string, result: Record<string, unknown>): Promise<void>;
  fail(actor: string, request: string, code: string): Promise<void>;
}
export class AiStore implements AnalysisStore {
  constructor(private readonly db: Database, private readonly dailyLimit = process.env.TRUSTGUARD_AI_DAILY_LIMIT) {}
  async get(actor: string, request: string) {
    return (await this.db.pool.query<AiRow>('SELECT * FROM ai_analyses WHERE actor_hash=$1 AND request_id=$2', [actor, request])).rows[0];
  }
  async reserve(actor: string, request: string, asset: string, digest: string) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      // Global short transaction serializes cost limits across API processes.
      await client.query('SELECT pg_advisory_xact_lock(34014005)');
      const previous = await client.query('SELECT 1 FROM ai_analyses WHERE actor_hash=$1 AND request_id=$2', [actor, request]);
      if (previous.rowCount) { await client.query('COMMIT'); return false; }
      if (this.dailyLimit !== undefined) {
        if (!/^[1-9][0-9]{0,5}$/.test(this.dailyLimit)) throw aiError('AI_CONFIGURATION_INVALID');
        const total = await client.query<{ used: string }>(`SELECT count(*) AS used FROM ai_analyses
          WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`);
        if (Number(total.rows[0].used) >= Number(this.dailyLimit)) throw aiError('AI_BUDGET_EXHAUSTED', 429);
      }
      const count = await client.query<{ running: number; recent: number }>(`SELECT
        (SELECT count(*)::int FROM ai_analyses WHERE state='running' AND created_at>now()-interval '2 minutes') AS running,
        (SELECT count(*)::int FROM ai_analyses WHERE actor_hash=$1 AND created_at>now()-interval '1 minute') AS recent`, [actor]);
      if (count.rows[0].running >= 2 || count.rows[0].recent >= 5) throw aiError('AI_RATE_LIMITED', 429);
      await client.query('INSERT INTO ai_analyses(actor_hash,request_id,asset_id,payload_hash,state) VALUES($1,$2,$3,$4,\'running\')', [actor, request, asset, digest]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async complete(actor: string, request: string, result: Record<string, unknown>) {
    await this.db.pool.query("UPDATE ai_analyses SET state='completed',result=$3::jsonb,finished_at=now() WHERE actor_hash=$1 AND request_id=$2 AND state='running'", [actor, request, JSON.stringify(result)]);
  }
  async fail(actor: string, request: string, code: string) {
    await this.db.pool.query("UPDATE ai_analyses SET state='failed',error_code=$3,finished_at=now() WHERE actor_hash=$1 AND request_id=$2 AND state='running'", [actor, request, code]);
  }
}
