import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ApiClient} from './api-client.mjs';
import {Database} from '../dist/database.js';
import {FabricService} from '../dist/gateway.js';
import {loadConfiguration,sha256} from '../dist/config.js';

const api=new ApiClient(),config=loadConfiguration(),db=new Database(config.databaseUrl),fabric=new FabricService(config),id='correction-'+randomUUID().slice(0,8);let sequence=0;
const report={network:'local',channel:config.channel,id,transactions:[]};
async function command(who,resource,data,errorCode){
  const response=await api.call(who,'POST','/commands/'+resource,{requestId:id+'-'+sequence++,data});
  if(errorCode){assert.equal(response.body.stage,'rejected');assert.equal(response.body.errorCode,errorCode);}
  else{assert.equal(response.body.completed,true,resource+':'+response.body.errorCode);report.transactions.push({action:resource,txId:response.body.txId,stage:response.body.stage});}
  return response.body;
}
try{
  await api.ready();
  for(const [state,field,proposer,voters] of [['IN_USE','firstUseAt','pack-operator',['pack-auditor','lab-auditor']],['PROCESSED','scrappedAt','recycle-recycler',['pack-auditor','lab-auditor','recycle-auditor']]]){
    const selected=await db.pool.query('SELECT body FROM asset_index WHERE body->>\'state\'=$1 ORDER BY id LIMIT 1',[state]);assert(selected.rows[0]);const original=selected.rows[0].body;
    const next=new Date(Date.parse(original[field])+86400000).toISOString().replace(/\.\d{3}Z$/,'Z'),correctionId=id+'-'+field;
    const input={id:correctionId,assetId:original.id,field,newValue:next,evidenceHash:sha256('simulated corrected source record'),reasonHash:sha256('simulated clerical correction'),assetVersion:original.version};
    await command(proposer,'lifecycle-corrections',input);
    await command(proposer,'lifecycle-correction-applications',{id:correctionId},'APPROVALS_MISSING');
    for(const voter of voters)await command(voter,'lifecycle-correction-approvals',{id:correctionId});
    await command(proposer,'lifecycle-correction-applications',{id:correctionId});
    const after=await api.call(proposer,'GET','/assets/'+original.id);assert.equal(after.body.state,state);assert.equal(after.body[field],next);
    const records=await api.call(proposer,'GET',`/assets/${original.id}/corrections`);
    const record=records.body.find(r=>r.id===correctionId);assert.equal(record.oldValue,original[field]);assert.equal(record.newValue,next);assert.equal(record.state,'APPLIED');
    const histories=[];const base=config.identities.find(i=>i.name===proposer);
    for(const target of [...new Map(config.identities.map(i=>[i.mspId,i])).values()]){
      histories.push(await fabric.query({...base,name:base.name+'-'+target.mspId,gatewayEndpoint:target.gatewayEndpoint,gatewayServerName:target.gatewayServerName,gatewayTlsRootFile:target.gatewayTlsRootFile},'history',original.id));
    }
    for(const history of histories){assert(history.some(r=>r.value[field]===original[field]));assert(history.some(r=>r.value[field]===next));assert.deepEqual(history,histories[0]);}
    if(state==='PROCESSED')await command('recycle-recycler','first-use',{assetId:original.id,at:next,evidenceHash:sha256('invalid return')},'INVALID_STATE');
  }
  const modules=await db.pool.query("SELECT body FROM asset_index WHERE body->>'type'='MODULE' AND body->>'state'='ASSEMBLED' AND COALESCE(body->>'parentId','')='' AND jsonb_array_length(body->'children')>0 ORDER BY id LIMIT 1");assert(modules.rows[0]);const module=modules.rows[0].body;
  await command('pack-assembler','assembly',{parentId:module.id,children:[],revision:module.assemblyVersion+1,evidenceHash:sha256('simulated complete disassembly')});
  const empty=await api.call('pack-viewer','GET','/assets/'+module.id);assert.deepEqual(empty.body.children,[]);assert.equal(empty.body.state,'REGISTERED');
  for(const childId of module.children){const child=await api.call('cell-viewer','GET','/assets/'+childId);assert.equal(child.body.parentId??'','');}
  const edges=await api.call('pack-viewer','GET',`/assets/${module.id}/assembly-history`);assert(edges.body.every(e=>e.activeTo!==null));
  const contextual=await db.pool.query("SELECT body FROM asset_index WHERE body->>'type'='CELL' AND COALESCE(body->>'parentId','')<>'' ORDER BY id LIMIT 1");
  const child=await api.call('cell-viewer','GET','/batteries/'+contextual.rows[0].body.code);assert(child.body.containingPack);assert.equal(child.body.firstUseAt,null);assert.equal(child.body.serviceAge,null);
  report.result='PASS';report.independentCorrectionReviews=true;report.processedNeverRevived=true;report.originalHistoryRetainedOnFourPeers=true;report.completeDisassembly=true;report.childAgeNotInvented=true;report.completedAt=new Date().toISOString();
  await writeFile(path.resolve(import.meta.dirname,'../../../docs/reports',`correction-verification-${id}.json`),JSON.stringify(report,null,2)+'\n');
  console.log('Independent lifecycle correction, four-peer history, terminal-state protection and complete disassembly PASS');
}catch(error){console.error('Correction verification stopped: '+error.message);process.exitCode=1;}
finally{api.close();await db.close();await fabric.close();}
