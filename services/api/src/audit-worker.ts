import {readFile} from 'node:fs/promises';
import {createPublicKey,verify} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from './database.js';
import {FabricService} from './gateway.js';
import {TransactionService} from './transactions.js';
import {loadFabricConfiguration,requiredEnv,canonicalJson,sha256} from './config.js';
import {auditSigner} from './audit-identity.js';

interface SecurityLog{
  id:string;actor_hash:string;request_id:string|null;action:string;outcome:string;evidence_hash:string;signature:string;created_at:Date;signature_version:number;
}
interface AuditBatch{id:string;digest:string;count:number;row_ids:string[];}
function normalized(row:SecurityLog){return {id:row.id,actorHash:row.actor_hash,requestId:row.request_id,action:row.action,outcome:row.outcome,
  evidenceHash:row.evidence_hash,signature:row.signature,signatureVersion:row.signature_version,createdAt:row.created_at.toISOString()};}
async function batch(database:Database):Promise<{batch:AuditBatch;rows:SecurityLog[]}|null>{
  const client=await database.pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(34014004)');
    const pending=await client.query<AuditBatch>('SELECT id,digest,count,row_ids FROM audit_batches WHERE tx_id IS NULL ORDER BY created_at,id LIMIT 1');
    if(pending.rows[0]){
      const selected=pending.rows[0],logs=await client.query<SecurityLog>('SELECT * FROM security_logs WHERE id=ANY($1::bigint[]) ORDER BY id',[selected.row_ids]);
      await client.query('COMMIT');return {batch:selected,rows:logs.rows};
    }
    const logs=await client.query<SecurityLog>('SELECT * FROM security_logs WHERE anchored_tx_id IS NULL AND audit_batch_id IS NULL ORDER BY id LIMIT 200');
    if(!logs.rows.length){await client.query('COMMIT');return null;}
    const digest=sha256(canonicalJson(logs.rows.map(normalized))),first=logs.rows[0].id,last=logs.rows.at(-1)!.id;
    const selected={id:`audit-${first}-${last}-${digest.slice(0,12)}`,digest,count:logs.rows.length,row_ids:logs.rows.map(row=>row.id)};
    await client.query('INSERT INTO audit_batches(id,first_log_id,last_log_id,count,digest,row_ids) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[selected.id,first,last,selected.count,digest,JSON.stringify(selected.row_ids)]);
    await client.query('UPDATE security_logs SET audit_batch_id=$1 WHERE id=ANY($2::bigint[])',[selected.id,selected.row_ids]);
    await client.query('COMMIT');return {batch:selected,rows:logs.rows};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function main(){
  const config=loadFabricConfiguration(),database=new Database(requiredEnv('TRUSTGUARD_DATABASE_URL'));await database.migrate();
  const fabric=new FabricService(config),transactions=new TransactionService(database,fabric);
  const independentMSP = process.env.TRUSTGUARD_AUDIT_SIGNER_MSP;
  const identity = await auditSigner(config.identities, independentMSP);
  const actor={identity,actorHash:sha256(identity.mspId+':'+identity.clientFingerprint)};
  const verifyKeyFile = independentMSP !== undefined ? requiredEnv('TRUSTGUARD_AUDIT_VERIFY_KEY_FILE')
    : process.env.TRUSTGUARD_AUDIT_VERIFY_KEY_FILE ?? path.join(path.dirname(requiredEnv('TRUSTGUARD_AUDIT_KEY_FILE')),'audit-signing.pub');
  const publicKey=createPublicKey(await readFile(verifyKeyFile));
  let stopped=false;process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
  const interval=Number(process.env.TRUSTGUARD_AUDIT_INTERVAL_MS??30000);
  if(!Number.isSafeInteger(interval)||interval<1000||interval>60000)throw new Error('INVALID_AUDIT_INTERVAL');
  try{do{
    const selected=await batch(database);
    if(selected){
      const {rows,batch}=selected;
      if(rows.length!==batch.count||sha256(canonicalJson(rows.map(normalized)))!==batch.digest)throw new Error('AUDIT_BATCH_CHANGED');
      for(const row of rows){
        const fields={actorHash:row.actor_hash,requestId:row.request_id,action:row.action,outcome:row.outcome};
        const digest=sha256(canonicalJson(row.signature_version===2?{...fields,issuedAt:row.created_at.toISOString()}:fields));
        if(digest!==row.evidence_hash||!verify(null,Buffer.from(digest,'hex'),publicKey,Buffer.from(row.signature,'base64')))throw new Error('SECURITY_LOG_SIGNATURE_FAILED');
      }
      const digest=batch.digest,id=batch.id;
      const command={requestId:id,action:'AnchorAudit',data:{id,digest,count:rows.length}};
      const previous=await transactions.replay(actor,command);
      let result=previous?await transactions.status(actor,id):await transactions.execute(actor,command);
      if(result.completed){
        if (independentMSP !== undefined) {
          const proof = await fabric.query<{id:string;digest:string;count:number;actorMSP:string;txId:string}>(identity, 'auditAnchor', id);
          if (proof.id !== id || proof.digest !== digest || proof.count !== rows.length ||
            proof.actorMSP !== identity.mspId || proof.txId !== result.txId) throw new Error('AUDIT_ANCHOR_MISMATCH');
        }
        const client=await database.pool.connect();
        try{await client.query('BEGIN');
          await client.query('UPDATE audit_batches SET tx_id=$2 WHERE id=$1',[id,result.txId]);
          await client.query('UPDATE security_logs SET anchored_tx_id=$1 WHERE id=ANY($2::bigint[]) AND anchored_tx_id IS NULL',[result.txId,rows.map(row=>row.id)]);
          await client.query('COMMIT');
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
        console.log(`Audit batch anchored and ledger-verified; ${rows.length} records`);
      }else{console.error('Audit batch awaiting original transaction reconciliation');}
    }
    if(process.env.TRUSTGUARD_AUDIT_ONCE==='1')break;
    // Small waits permit prompt shutdown without interrupting an uncertain submission.
    for(let waited=0;!stopped&&waited<interval;waited+=250)await delay(250);
  }while(!stopped);}finally{await fabric.close();await database.close();}
}
main().catch(()=>{console.error('Audit worker stopped: verify signatures and original transaction state');process.exitCode=1;});
