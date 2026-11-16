import { readFile,readdir } from 'node:fs/promises';
import { Pool } from 'pg';

export class Database {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(1400142026)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
      const applied=await client.query<{version:number}>('SELECT version FROM schema_migrations');
      const versions=new Set(applied.rows.map(row=>row.version));
      const directory=new URL('../migrations/',import.meta.url);
      const files=(await readdir(directory)).filter(file=>/^\d{3}_[a-z_]+\.sql$/.test(file)).sort();
      for(const file of files){
        const version=Number(file.slice(0,3));if(versions.has(version))continue;
        await client.query(await readFile(new URL(file,directory),'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',[version]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}
