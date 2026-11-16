import { loadConfiguration } from './config.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { Indexer } from './indexer.js';

async function main() {
  const config = loadConfiguration();
  const database = new Database(config.databaseUrl);
  await database.migrate();
  const fabric = new FabricService(config);
  const identity = config.identities.find(i => i.name === (process.env.TRUSTGUARD_INDEXER_IDENTITY ?? 'lab-auditor'));
  if (!identity) throw new Error('INDEXER_IDENTITY_REQUIRED');
  const indexer = new Indexer(database, fabric, identity, config.channel, config.chaincode);
  process.once('SIGTERM', () => indexer.stop()); process.once('SIGINT', () => indexer.stop());
  try { await indexer.run(process.env.TRUSTGUARD_INDEX_UNTIL ? BigInt(process.env.TRUSTGUARD_INDEX_UNTIL) : undefined); }
  finally { await fabric.close(); await database.close(); }
}
main().catch(() => { console.error('Index worker failed: check database and Fabric availability'); process.exitCode = 1; });
