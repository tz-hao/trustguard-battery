import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import path from 'node:path';
import {peer} from '@hyperledger/fabric-protos';
import {loadConfiguration,canonicalJson,sha256} from '../dist/config.js';
import {Database} from '../dist/database.js';
import {FabricService} from '../dist/gateway.js';
import {TransactionService} from '../dist/transactions.js';
import {AuditService} from '../dist/audit.js';

const config=loadConfiguration(),db=new Database(config.databaseUrl),fabric=new FabricService(config),transactions=new TransactionService(db,fabric),audit=new AuditService(db);
const id='mvcc-'+randomUUID().slice(0,8);let serial=randomInt(1_000_000,8_000_000),sequence=0;
const identity=name=>config.identities.find(i=>i.name===name);
const actor=name=>{const i=identity(name);return {identity:i,actorHash:sha256(i.mspId+':'+i.clientFingerprint)};};
async function execute(who,action,data){const result=await transactions.execute(actor(who),{requestId:id+'-'+sequence++,action,data});assert.equal(result.completed,true,action+':'+result.errorCode);return result;}
try{
  const {rows}=await db.pool.query("SELECT body FROM asset_index WHERE body->>'type'='CELL' ORDER BY id LIMIT 1");assert(rows[0]);
  const cellId=id+'-cell',moduleId=id+'-module',batchId=rows[0].body.batchId;
  for(const [assetId,type,maker,who] of [[cellId,'C','SMA','cell-manufacturer'],[moduleId,'M','DMA','pack-manufacturer']]){
    const code=maker+type+'B01'+'0000001'+'E11'+String(serial++).padStart(7,'0');
    await execute(who,'RegisterAsset',{id:assetId,code,batchId:type==='C'?batchId:'',model:'sim-3000',manufacturedAt:'2024-01-01',manufactureSourceHash:sha256('simulated concurrency manufacturing record'),designLifeMonths:null,specSourceHash:''});
  }
  await execute('cell-manufacturer','AuthorizeAssembly',{childId:cellId,parentId:moduleId,evidenceHash:sha256('simulated supply authorization')});
  const assembler=identity('pack-assembler'),data={parentId:moduleId,children:[cellId],revision:1,evidenceHash:sha256('concurrent identical assembly intents')};
  const firstCommand={requestId:id+'-race-a',action:'ReplaceAssembly',data},secondCommand={...firstCommand,requestId:id+'-race-b'};
  const first=await fabric.proposal(assembler,firstCommand),second=await fabric.proposal(assembler,secondCommand);
  const [firstTx,secondTx]=await Promise.all([first.endorse(),second.endorse()]);
  const firstSubmitted=await firstTx.submit(),firstStatus=await firstSubmitted.getStatus();assert.equal(firstStatus.successful,true);
  const verified=await fabric.verifyCommitted(assembler,first.getTransactionId(),firstCommand.requestId);
  await db.pool.query(`INSERT INTO transaction_requests(actor_hash,request_id,payload_hash,command,stage,tx_id) VALUES($1,$2,$3,$4::jsonb,'submitted',$5)`,
    [actor('pack-assembler').actorHash,secondCommand.requestId,sha256(canonicalJson(secondCommand)),JSON.stringify(secondCommand),second.getTransactionId()]);
  const secondSubmitted=await secondTx.submit(),secondStatus=await secondSubmitted.getStatus();
  assert.equal(secondStatus.successful,false);assert.equal(secondStatus.code,peer.TxValidationCode.MVCC_READ_CONFLICT);
  const reconciled=await transactions.status(actor('pack-assembler'),secondCommand.requestId);assert.equal(reconciled.stage,'invalid');assert.equal(reconciled.completed,false);
  const parent=await fabric.query(assembler,'asset',moduleId),cell=await fabric.query(assembler,'asset',cellId),edges=await fabric.query(assembler,'edges',moduleId);
  assert.equal(parent.assemblyVersion,1);assert.equal(parent.version,2);assert.deepEqual(parent.children,[cellId]);assert.equal(cell.parentId,moduleId);assert.equal(edges.length,1);
  await audit.record(actor('pack-assembler').actorHash,secondCommand.requestId,'ReplaceAssembly','COMMIT_INVALID:MVCC_READ_CONFLICT');
  const report={network:'local',channel:config.channel,name:id,result:'PASS',first:{txId:first.getTransactionId(),stage:'ledger-verified',blockNumber:verified.blockNumber},
    second:{txId:second.getTransactionId(),stage:reconciled.stage,validationCode:secondStatus.code,blockNumber:secondStatus.blockNumber.toString()},
    singleEffectiveBinding:true,reconciliationDistinguishesInvalid:true,completedAt:new Date().toISOString()};
  await writeFile(path.resolve(import.meta.dirname,'../../../docs/reports',`concurrency-verification-${id}.json`),JSON.stringify(report,null,2)+'\n');
  console.log('Concurrent assembly MVCC conflict, single effective binding and invalid-status reconciliation PASS');
}catch(error){console.error('Concurrency verification stopped: '+error.message);process.exitCode=1;}
finally{await fabric.close();await db.close();}
