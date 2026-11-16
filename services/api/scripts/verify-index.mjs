import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {loadConfiguration,sha256} from '../dist/config.js';
import {Database} from '../dist/database.js';
import {FabricService} from '../dist/gateway.js';
import {Indexer} from '../dist/indexer.js';
import {TransactionService} from '../dist/transactions.js';

const config=loadConfiguration(),runtime=path.dirname(process.env.TRUSTGUARD_IDENTITIES_FILE);
const primary=new Database(config.databaseUrl),fabric=new FabricService(config);
const name='rebuild_'+randomUUID().replaceAll('-','').slice(0,12);
const admin=new Pool({host:'127.0.0.1',port:15432,database:'trustguard',user:'trustguard_admin',password:(await readFile(path.join(runtime,'postgres-secrets/password'),'utf8')).trim(),max:1});
let shadow;
try{
  const identity=config.identities.find(i=>i.name==='lab-auditor');
  const height=await fabric.height(identity);
  await admin.query(`CREATE SCHEMA ${name} AUTHORIZATION trustguard_api`);
  const url=new URL(config.databaseUrl);url.searchParams.set('options','-c search_path='+name);
  shadow=new Database(url.toString());await shadow.migrate();
  const midpoint=height/2n;
  const first=new Indexer(shadow,fabric,identity,config.channel,config.chaincode);
  await first.run(midpoint);
  const checkpoint=await shadow.pool.query('SELECT next_block FROM index_cursors WHERE channel=$1',[config.channel]);assert.equal(BigInt(checkpoint.rows[0].next_block),midpoint+1n);
  const resumed=new Indexer(shadow,fabric,identity,config.channel,config.chaincode);await resumed.run(height-1n);
  for(let attempt=0;attempt<40;attempt++){
    const cursor=await primary.pool.query('SELECT next_block FROM index_cursors WHERE channel=$1',[config.channel]);
    if(BigInt(cursor.rows[0]?.next_block??'0')>=height)break;await delay(250);
  }
  const query='SELECT id,code,body,block_number,tx_id FROM asset_index ORDER BY id';
  const expected=await primary.pool.query(query),rebuilt=await shadow.pool.query(query);assert.deepEqual(rebuilt.rows,expected.rows);
  const originalCount=Number((await shadow.pool.query('SELECT count(*) FROM ledger_events')).rows[0].count);
  const last=await fabric.block(identity,height-1n);await Promise.all([resumed.apply(last),new Indexer(shadow,fabric,identity,config.channel,config.chaincode).apply(last)]);
  assert.equal(Number((await shadow.pool.query('SELECT count(*) FROM ledger_events')).rows[0].count),originalCount);
  const tx=new TransactionService(primary,fabric),requestId=name+'-anchor';
  const result=await tx.execute({identity,actorHash:sha256(identity.mspId+':'+identity.clientFingerprint)},
    {requestId,action:'AnchorAudit',data:{id:name+'-evidence',digest:sha256('index recovery verification'),count:1}});
  assert.equal(result.completed,true);
  const block=await fabric.block(identity,BigInt(result.blockNumber));
  assert.equal(BigInt(result.blockNumber),height);
  // Force one failure after state writes but before the checkpoint; transaction must roll back.
  const connect=shadow.pool.connect.bind(shadow.pool);
  let injected=false;
  shadow.pool.connect=async()=>{
    const client=await connect(),query=client.query.bind(client);
    client.query=(sql,...args)=>{
      if(!injected&&typeof sql==='string'&&sql.startsWith('INSERT INTO ledger_events')){injected=true;throw new Error('INJECTED_INDEX_FAILURE');}
      return query(sql,...args);
    };
    const release=client.release.bind(client);client.release=(...args)=>{client.query=query;release(...args);};return client;
  };
  await assert.rejects(resumed.apply(block),/INJECTED_INDEX_FAILURE/);
  shadow.pool.connect=connect;
  assert.equal(Number((await shadow.pool.query('SELECT count(*) FROM ledger_events')).rows[0].count),originalCount);
  const afterFailure=await shadow.pool.query('SELECT next_block FROM index_cursors WHERE channel=$1',[config.channel]);assert.equal(BigInt(afterFailure.rows[0].next_block),height);
  await Promise.all([resumed.apply(block),new Indexer(shadow,fabric,identity,config.channel,config.chaincode).apply(block)]);
  assert.equal(Number((await shadow.pool.query('SELECT count(*) FROM ledger_events')).rows[0].count),originalCount+1);
  const report={network:'local',channel:config.channel,result:'PASS',isolatedSchema:name,assets:rebuilt.rows.length,
    initialHeight:height.toString(),checkpointResumeVerified:true,rebuiltStateEqualsPrimary:true,duplicateDeliveryDeduplicated:true,
    interruptedTransactionRolledBack:true,concurrentDeliveryDeduplicated:true,anchorTx:result.txId,completedAt:new Date().toISOString()};
  await writeFile(path.resolve(import.meta.dirname,'../../../docs/reports',`index-verification-${name}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(`Index resume, full rebuild, rollback and concurrent deduplication PASS; ${rebuilt.rows.length} assets`);
}catch(error){console.error('Index verification failed: '+error.message);process.exitCode=1;}
finally{await shadow?.close();await primary.close();await fabric.close();await admin.end();}
