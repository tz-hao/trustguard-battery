import assert from 'node:assert/strict';
import https from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey, sign, randomUUID, randomInt } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfiguration, canonicalJson, sha256 } from '../dist/config.js';
import { FabricService } from '../dist/gateway.js';
import { Database } from '../dist/database.js';
import { AuditService } from '../dist/audit.js';
import { signPermit } from '../dist/cryptography.js';
import { safeErrorCode } from '../dist/transactions.js';

const root = path.resolve(import.meta.dirname, '../../..');
const config = loadConfiguration();
const runtime = path.dirname(process.env.TRUSTGUARD_IDENTITIES_FILE);
const fabric = new FabricService(config);
const db = new Database(config.databaseUrl);
const audit = new AuditService(db);
const runId = 'demo-' + randomUUID().slice(0,8);
const report = { network: 'local', channel: config.channel, chaincode: config.chaincode, runId,
  simulation: true, transactions: [], attacks: [], samples: [], startedAt: new Date().toISOString() };
const agents = new Map();
let sequence = 0, serial = randomInt(1_000_000,8_000_000);
const name = suffix => `${runId}-${suffix}`;
const reportFile = path.join(root, `docs/reports/business-demo-${runId}.json`);
const save = () => writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
const identity = name => { const value=config.identities.find(i=>i.name===name);assert(value,'test identity missing');return value; };
async function agent(who) {
  if (!agents.has(who)) {
    const [org,role] = who.split('-');
    const base = path.join(runtime,'organizations',org,'users',role);
    agents.set(who,new https.Agent({cert:await readFile(path.join(base,'api.crt')),key:await readFile(path.join(base,'api.key')),
      ca:await readFile(path.join(runtime,'server-ca/ca.crt')),rejectUnauthorized:true,keepAlive:true}));
  }
  return agents.get(who);
}
async function api(who,method,route,body) {
  const tlsAgent=await agent(who);
  const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
    const request=https.request('https://localhost:13000/api/v1'+route,{method,agent:tlsAgent,timeout:120000,
      headers:bytes?{'content-type':'application/json','content-length':bytes.length}:{}},response=>{
      const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
        const content=Buffer.concat(chunks);
        const value=response.headers['content-type']?.includes('application/json')?JSON.parse(content.toString()):content;
        resolve({status:response.statusCode,value});
      });response.on('error',reject);
    });request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('DEMO_REQUEST_TIMEOUT')));request.end(bytes);
  });
}
async function command(who,resource,data,{rejectCode}={}) {
  const requestId=name(`request-${sequence++}`);
  const start=performance.now();
  const response=await api(who,'POST','/commands/'+resource,{requestId,data});
  if (rejectCode) {
    assert.equal(response.value.stage,'rejected',`${resource} rejection stage`);
    assert.equal(response.value.errorCode,rejectCode,`${resource} rejection code`);
  } else {
    if (!response.value.completed) throw new Error(`${resource}:${response.value.code??response.value.errorCode??response.value.stage}`);
    report.transactions.push({action:resource,identity:who,requestId,txId:response.value.txId,stage:response.value.stage,blockNumber:response.value.blockNumber,latencyMs:performance.now()-start});
    await save();
  }
  return response.value;
}
async function asset(who,id){const response=await api(who,'GET','/assets/'+id);assert.equal(response.status,200);return response.value;}
async function unchanged(who,id,before){assert.deepEqual(await asset(who,id),before);}
async function maker(who,code,msp){
  const existing=await api(who,'GET','/makers/'+code);
  if (existing.status===200) {assert.equal(existing.value.msp,msp);assert.equal(existing.value.simulation,true);return;}
  assert.equal(existing.value.code,'NOT_FOUND');
  await command(who,'makers',{code,name:`模拟制造企业 ${code}`,msp,simulation:true,sourceHash:sha256('simulation manufacturer profile '+code)});
}
async function register(kind,chemistry,suffix,batchId=''){
  const code=(kind==='CELL'?'SMA':'DMA')+({CELL:'C',MODULE:'M',PACK:'P'}[kind])+chemistry+'01'+'0000001'+'E11'+String(serial++).padStart(7,'0');
  assert.equal(code.length,24);
  const id=name(suffix);
  await command(kind==='CELL'?'cell-manufacturer':'pack-manufacturer','assets',{
    id,code,batchId,model:'sim-3000',manufacturedAt:'2024-01-01',manufactureSourceHash:sha256('simulated manufacturing record'),designLifeMonths:96,specSourceHash:sha256('simulated model specification'),
  });return {id,code};
}
async function inspect(id,result='QC_PASSED'){
  const current=await asset('lab-inspector',id);
  const reportId=name(`inspection-${sequence++}`),version=current.inspectionVersion+1;
  const plaintext=Buffer.from(JSON.stringify({simulation:true,assetId:id,result,version,source:'local signed LIMS demonstration'}));
  const binding={id:reportId,assetId:id,version,plaintextHash:sha256(plaintext)};
  const key=createPrivateKey(await readFile(identity('lab-inspector').privateKeyFile));
  const sourceSignature=sign('sha256',Buffer.from(canonicalJson(binding)),key).toString('base64');
  const uploadBody={requestId:reportId,...binding,sourceSignature,contentBase64:plaintext.toString('base64')};
  const uploaded=await api('lab-inspector','POST','/reports',uploadBody);
  if(uploaded.status!==201)throw new Error('REPORT_UPLOAD:'+uploaded.value.code);
  await command('lab-inspector','inspections',{id:reportId,assetId:id,version,result,reportHash:binding.plaintextHash,sourceHash:uploaded.value.sourceHash});
  const replay=await api('lab-inspector','POST','/reports',uploadBody);assert.deepEqual(replay.value,uploaded.value);
  const downloaded=await api('lab-inspector','GET',`/reports/${reportId}/content`);
  assert.equal(downloaded.status,200);assert.deepEqual(downloaded.value,plaintext);
  return {id:reportId,plaintext,binding,sourceSignature};
}
async function measurements(batchId,cell,chemistry){
  const header='asset_id,batch_id,chemistry,model,condition,capacity_mah,resistance_uohm,voltage_mv,temperature_c,simulation';
  const content=Buffer.from(`${header}\n${cell.id},${batchId},${chemistry==='B'?'LFP':'TERNARY'},sim-3000,25C-1C,3000,1500,${chemistry==='B'?3300:3700},25,true\n`);
  const issuedAt=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  const payload=JSON.stringify({sourceId:'lab-source',batchId,payloadHash:sha256(content),issuedAt});
  const key=createPrivateKey(await readFile(path.join(runtime,'services/source-signing.key')));
  const signature=sign(null,Buffer.from(payload),key).toString('base64');
  const response=await api('lab-inspector','POST','/imports/measurements',{requestId:name(`csv-${sequence++}`),sourceId:'lab-source',batchId,issuedAt,signature,contentBase64:content.toString('base64')});
  if(response.status!==201)throw new Error('CSV_IMPORT:'+response.value.code);
  assert.equal(response.value.records,1);
}
async function buildPack(suffix,chemistry){
  const batchId=name(suffix+'-batch');
  await command('cell-manufacturer','batches',{id:batchId,makerMSP:'CellOrgMSP',materialLotIds:[name('material')],simulation:true});
  const cell=await register('CELL',chemistry,suffix+'-cell',batchId);
  const module=await register('MODULE',chemistry,suffix+'-module');
  const pack=await register('PACK',chemistry,suffix+'-pack');
  await command('cell-manufacturer','assembly-authorizations',{childId:cell.id,parentId:module.id,evidenceHash:sha256('simulated supply permission')});
  await command('pack-assembler','assembly',{parentId:module.id,children:[cell.id],revision:1,evidenceHash:sha256('simulated cell binding')});
  await command('pack-assembler','assembly',{parentId:pack.id,children:[module.id],revision:1,evidenceHash:sha256('simulated module binding')});
  await measurements(batchId,cell,chemistry);
  return {batchId,cell,module,pack};
}
async function release(pack){
  const id=name(`release-${sequence++}`),requestId=name(`request-${sequence++}`);
  const response=await api('pack-release','POST','/release/requests',{id,packId:pack.id,requestId});
  if(!response.value.completed)throw new Error('RELEASE_REQUEST:'+ (response.value.code??response.value.errorCode));
  report.transactions.push({action:'release-request',requestId,txId:response.value.txId,stage:response.value.stage,blockNumber:response.value.blockNumber});
  for(const who of ['cell-approver','lab-approver','pack-approver'])await command(who,'release-approvals',{id});
  // Explicit extra review also covers unknown/untrained chemistry groups in the demo.
  const snapshot=await fabric.query(identity('pack-release'),'release',id);
  if(snapshot.requiredOrgs.includes('RecycleOrgMSP'))await command('recycle-approver','release-approvals',{id});
  await command('pack-release','release-finalizations',{id});
}
async function attack(id,operation){
  await operation();report.attacks.push({id,result:'BLOCKED',verifiedStateUnchanged:true});await save();console.log(`${id}: blocked; ledger state verified unchanged`);
}

try {
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){
    try{const response=await api('cell-viewer','GET','/health');if(response.status===200){ready=true;break;}}
    catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code))throw error;}
    await delay(250);
  }
  assert(ready,'API readiness did not complete');
  await maker('cell-admin','SMA','CellOrgMSP');await maker('pack-admin','DMA','PackOrgMSP');
  await command('cell-manufacturer','material-lots',{id:name('material'),ownerMSP:'CellOrgMSP',sourceHash:sha256('simulated material record'),simulation:true});
  const batch=name('standalone-batch');
  await command('cell-manufacturer','batches',{id:batch,makerMSP:'CellOrgMSP',materialLotIds:[name('material')],simulation:true});
  const standalone=await register('CELL','B','standalone',batch);
  const live=await buildPack('live','E');
  const liveInspection=await inspect(live.cell.id,'QC_REJECTED');
  await attack('A1',async()=>{
    const before=await asset('cell-viewer',live.cell.id);
    const proposal=await fabric.proposal(identity('pack-manufacturer'),{requestId:name('a1'),action:'SubmitInspection',data:{id:name('spoof'),assetId:live.cell.id,version:2,result:'QC_PASSED',reportHash:sha256('fake'),sourceHash:sha256('fake')}});
    await assert.rejects(proposal.endorse(),error=>safeErrorCode(error)==='FORBIDDEN');
    await audit.record(sha256('pack-manufacturer'),name('a1'),'SubmitInspection','ENDORSEMENT_REJECTED:FORBIDDEN');
    await unchanged('cell-viewer',live.cell.id,before);
  });
  await inspect(live.module.id);await inspect(live.pack.id);
  await attack('A2',async()=>{
    const before=await asset('pack-viewer',live.pack.id);
    const response=await api('pack-release','POST','/release/requests',{id:name('bad-release'),packId:live.pack.id,requestId:name('a2')});
    assert.equal(response.value.stage,'rejected');assert.equal(response.value.errorCode,'QUALITY_GATE');await unchanged('pack-viewer',live.pack.id,before);
  });
  await attack('A3',async()=>{
    const before=await asset('lab-inspector',live.cell.id);
    const response=await api('lab-inspector','POST','/reports',{requestId:name('tampered'),...liveInspection.binding,id:name('tampered'),sourceSignature:liveInspection.sourceSignature,contentBase64:Buffer.from('tampered simulation report').toString('base64')});
    assert.equal(response.status,400);assert.equal(response.value.code,'REPORT_HASH_MISMATCH');await unchanged('lab-inspector',live.cell.id,before);
  });
  await inspect(live.cell.id);
  await release(live.pack);
  await command('pack-operator','installations',{assetId:live.pack.id,at:'2024-06-30T00:00:00Z',evidenceHash:sha256('simulated installation')});
  await command('pack-operator','first-use',{assetId:live.pack.id,at:'2024-07-01T00:00:00Z',evidenceHash:sha256('simulated first use')});
  const retired=await buildPack('retired','B');
  for(const item of [retired.cell,retired.module,retired.pack])await inspect(item.id);
  await release(retired.pack);
  await command('pack-operator','retirements',{assetId:retired.pack.id,at:'2026-11-01T00:00:00Z',evidenceHash:sha256('simulated retirement')});
  const transfer=name('recycle-transfer'),receiptHash=sha256('simulated dual custody receipt');
  await command('pack-custodian','transfers',{id:transfer,packId:retired.pack.id,toMSP:'RecycleOrgMSP',receiptHash,expiresAt:new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z')});
  await attack('A4',async()=>{const before=await asset('pack-viewer',retired.pack.id);await command('pack-custodian','transfer-confirmations',{id:transfer,receiptHash},{rejectCode:'FORBIDDEN'});await unchanged('pack-viewer',retired.pack.id,before);});
  await command('recycle-custodian','transfer-confirmations',{id:transfer,receiptHash});
  await command('recycle-recycler','recycling-receipts',{assetId:retired.pack.id,at:'2026-11-02T00:00:00Z',evidenceHash:sha256('simulated recycling receipt')});
  await command('recycle-recycler','scrap-confirmations',{assetId:retired.pack.id,at:'2026-11-03T00:00:00Z',evidenceHash:sha256('simulated formal scrap confirmation')});
  await attack('A5',async()=>{const before=await asset('recycle-viewer',retired.pack.id);await command('recycle-custodian','transfers',{id:name('invalid-return'),packId:retired.pack.id,toMSP:'PackOrgMSP',receiptHash,expiresAt:new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z')},{rejectCode:'FORBIDDEN'});await unchanged('recycle-viewer',retired.pack.id,before);});
  await attack('A6',async()=>{
    const before=await fabric.query(identity('cell-admin'),'policy');
    const candidate={id:name('weak-policy'),policy:{...before,version:before.version+1,requiredOrgs:['PackOrgMSP']}};
    const preview=await api('cell-admin','POST','/policies/previews',candidate);assert.equal(preview.status,201);assert.equal(preview.value.report.passed,false);
    const data={...candidate,testsHash:preview.value.testsHash};
    const denied=await api('cell-admin','POST','/commands/policy-candidates',{requestId:name('a6'),data});assert.equal(denied.status,409);assert.equal(denied.value.code,'POLICY_PREVIEW_REQUIRED');
    const proposal=await fabric.proposal(identity('cell-admin'),{requestId:name('a6-direct'),action:'ProposePolicy',data});
    await assert.rejects(proposal.endorse(),error=>safeErrorCode(error)==='UNSAFE_POLICY');
    assert.deepEqual(await fabric.query(identity('cell-admin'),'policy'),before);
  });
  await attack('A7',async()=>{const before=await asset('cell-viewer',live.pack.id);for(const code of [live.pack.code.slice(1),live.pack.code+'0',live.pack.code.slice(0,4)+'I'+live.pack.code.slice(5)]){const response=await api('cell-viewer','GET','/codes/'+code);assert.equal(response.status,400);}await unchanged('cell-viewer',live.pack.id,before);});
  await attack('A8',async()=>{const before=await asset('cell-viewer',live.pack.id);await command('cell-manufacturer','scrap-confirmations',{assetId:live.pack.id,at:'2026-11-03T00:00:00Z',evidenceHash:sha256('unauthorized simulated scrap')},{rejectCode:'FORBIDDEN'});await unchanged('cell-viewer',live.pack.id,before);});
  // Verify decryption permission revocation in both the API and independent broker path.
  const revoked=await api('lab-inspector','POST',`/reports/${liveInspection.id}/revocations`,{requestId:name('revoke-report'),granteeMSP:'CellOrgMSP'});assert.equal(revoked.status,201);
  const denied=await api('cell-manufacturer','GET',`/reports/${liveInspection.id}/content`);assert.equal(denied.status,403);
  const permitPrivate=createPrivateKey(await readFile(process.env.TRUSTGUARD_PERMIT_KEY_FILE));
  const issued=new Date();
  const permit=signPermit({reportId:liveInspection.id,actorMSP:'CellOrgMSP',actorRole:'manufacturer',nonce:randomUUID(),issuedAt:issued.toISOString(),expiresAt:new Date(issued.valueOf()+15000).toISOString()},permitPrivate);
  const workloadAgent=new https.Agent({cert:await readFile(process.env.TRUSTGUARD_WORKLOAD_CERT),key:await readFile(process.env.TRUSTGUARD_WORKLOAD_KEY),ca:await readFile(process.env.TRUSTGUARD_INTERNAL_SERVER_CA)});
  try{
    const status=await new Promise((resolve,reject)=>{
      const payload=JSON.stringify(permit);
      const request=https.request('https://localhost:18001/keys/open',{method:'POST',agent:workloadAgent,headers:{'content-type':'application/json','content-length':Buffer.byteLength(payload)}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
      request.on('error',reject);request.end(payload);
    });assert.equal(status,403);
  }finally{workloadAgent.destroy();}
  report.fileRevocation={result:'PASS',apiDenied:true,independentBrokerDenied:true};
  for(const sample of [standalone,live.pack,retired.pack]){
    const response=await api('cell-viewer','GET','/batteries/'+sample.code);assert.equal(response.status,200);
    report.samples.push({code:sample.code,id:sample.id,state:response.value.state,statusLabel:response.value.statusLabel,serviceAge:response.value.serviceAge,scrapped:response.value.scrapped,simulation:response.value.simulation});
  }
  assert.equal(report.samples[0].statusLabel,'未装配');assert.equal(report.samples[1].state,'IN_USE');assert(report.samples[1].serviceAge.years>=2);assert.equal(report.samples[2].scrapped,true);
  let trace;
  for(let attempt=0;attempt<40;attempt++){
    const response=await api('cell-viewer','GET','/trace/batch/'+live.batchId);trace=response.value;
    if(!trace.stale&&trace.current?.packIds.includes(live.pack.id))break;await delay(250);
  }
  assert.deepEqual(trace.current.packIds,[live.pack.id]);assert.equal(trace.stale,false);
  report.trace={result:'PASS',precision:1,recall:1,indexedBlock:trace.indexedBlock,ledgerHeight:trace.ledgerHeight};
  const timings=report.transactions.filter(t=>t.latencyMs).map(t=>t.latencyMs).sort((a,b)=>a-b);
  report.performance={transactions:report.transactions.length,p50Ms:timings[Math.floor(timings.length*.5)],p95Ms:timings[Math.min(timings.length-1,Math.floor(timings.length*.95))],scope:'Sequential local four-peer, one-orderer development workload only'};
  report.result='PASS';report.completedAt=new Date().toISOString();await save();
  console.log(`Local backend demo PASS: ${report.transactions.length} verified transactions, 8 blocked attacks, 3 sample states`);
} catch(error) {
  report.result='FAIL';report.failure={code:error.code??error.message??'DEMO_FAILED'};await save();
  console.error(`Local backend demo stopped: ${report.failure.code}`);process.exitCode=1;
} finally {for(const value of agents.values())value.destroy();await fabric.close();await db.close();}
