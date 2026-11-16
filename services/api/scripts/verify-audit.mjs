import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicKey,verify} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {loadConfiguration,canonicalJson,sha256} from '../dist/config.js';
import {Database} from '../dist/database.js';
import {FabricService} from '../dist/gateway.js';
import {parseBlock} from '../dist/indexer.js';

const root=path.resolve(import.meta.dirname,'../../..'),config=loadConfiguration(),db=new Database(config.databaseUrl),fabric=new FabricService(config),execute=promisify(execFile);
const normalize=row=>({id:row.id,actorHash:row.actor_hash,requestId:row.request_id,action:row.action,outcome:row.outcome,evidenceHash:row.evidence_hash,signature:row.signature,signatureVersion:row.signature_version,createdAt:row.created_at.toISOString()});
try{
  await db.migrate();
  for(let i=0;i<30;i++){
    const pending=await db.pool.query('SELECT count(*) FROM security_logs WHERE anchored_tx_id IS NULL');if(pending.rows[0].count==='0')break;
    await execute(process.execPath,[path.join(root,'services/api/dist/audit-worker.js')],{env:{...process.env,TRUSTGUARD_AUDIT_ONCE:'1'},timeout:120000,maxBuffer:65536});
    if(i===29)throw new Error('AUDIT_BACKLOG_NOT_DRAINED');
  }
  const publicKey=createPublicKey(await readFile(path.join(path.dirname(process.env.TRUSTGUARD_AUDIT_KEY_FILE),'audit-signing.pub')));
  const identity=config.identities.find(i=>i.name==='lab-auditor');
  const batches=await db.pool.query('SELECT * FROM audit_batches WHERE tx_id IS NOT NULL ORDER BY created_at');assert(batches.rows.length>0);
  let records=0,v2=0;
  for(const batch of batches.rows){
    const logs=await db.pool.query('SELECT * FROM security_logs WHERE id=ANY($1::bigint[]) ORDER BY id',[batch.row_ids]);
    assert.equal(logs.rows.length,batch.count);assert(logs.rows.every(r=>r.anchored_tx_id===batch.tx_id));
    assert.equal(sha256(canonicalJson(logs.rows.map(normalize))),batch.digest);
    for(const row of logs.rows){
      const fields={actorHash:row.actor_hash,requestId:row.request_id,action:row.action,outcome:row.outcome};
      const digest=sha256(canonicalJson(row.signature_version===2?{...fields,issuedAt:row.created_at.toISOString()}:fields));
      assert.equal(digest,row.evidence_hash);assert(verify(null,Buffer.from(digest,'hex'),publicKey,Buffer.from(row.signature,'base64')));
      const badDigest=sha256(canonicalJson({...fields,outcome:'ALTERED'}));assert(!verify(null,Buffer.from(badDigest,'hex'),publicKey,Buffer.from(row.signature,'base64')));
      records++;if(row.signature_version===2)v2++;
    }
    const proof=await fabric.verifyCommitted(identity,batch.tx_id,batch.id);
    const block=await fabric.block(identity,BigInt(proof.blockNumber)),writes=parseBlock(block,config.chaincode).writes;
    const anchored=writes.find(w=>w.key==='security-audit:'+batch.id);assert(anchored);assert.equal(anchored.body.digest,batch.digest);assert.equal(anchored.body.count,batch.count);
  }
  assert(v2>0,'timestamp-bound v2 logs missing');
  const report={network:'local',channel:config.channel,result:'PASS',batches:batches.rows.length,records,timestampBoundV2Records:v2,
    signaturesVerified:true,tamperingRejected:true,ledgerDigestsVerifiedOnFourPeers:true,completedAt:new Date().toISOString()};
  await writeFile(path.join(root,'docs/reports','audit-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Signed audit records and four-peer digest anchors PASS; ${records} records in ${batches.rows.length} batches`);
}catch(error){console.error('Audit verification stopped: '+error.message);process.exitCode=1;}
finally{await db.close();await fabric.close();}
