import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {createPrivateKey,sign,randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadConfiguration} from '../dist/config.js';
import {Database} from '../dist/database.js';

const root=path.resolve(import.meta.dirname,'../../..'),runtime=path.dirname(process.env.TRUSTGUARD_IDENTITIES_FILE),id='health-'+randomUUID().slice(0,8),db=new Database(loadConfiguration().databaseUrl),agents=[];
async function call(who,method,route,body){
  const [org,role]=who.split('-'),base=path.join(runtime,'organizations',org,'users',role);
  const agent=new https.Agent({cert:await readFile(path.join(base,'api.crt')),key:await readFile(path.join(base,'api.key')),ca:await readFile(path.join(runtime,'server-ca/ca.crt'))});agents.push(agent);
  return new Promise((resolve,reject)=>{
    const payload=body?JSON.stringify(body):undefined;
    const request=https.request('https://localhost:13000/api/v1'+route,{method,agent,headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}},response=>{
      const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});
    request.on('error',reject);request.end(payload);
  });
}
try{
  for(let i=0;i<60;i++){try{const response=await call('lab-inspector','GET','/health');if(response.status===200)break;}catch(error){if(error.code!=='ECONNREFUSED')throw error;}await delay(250);}
  const workload=new https.Agent({cert:await readFile(process.env.TRUSTGUARD_WORKLOAD_CERT),key:await readFile(process.env.TRUSTGUARD_WORKLOAD_KEY),ca:await readFile(process.env.TRUSTGUARD_INTERNAL_SERVER_CA)});agents.push(workload);
  let riskReady=false;
  for(let i=0;i<60;i++){
    try{const status=await new Promise((resolve,reject)=>{const request=https.get('https://localhost:18000/health',{agent:workload},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});request.on('error',reject);});if(status===200){riskReady=true;break;}}
    catch(error){if(error.code!=='ECONNREFUSED')throw error;}await delay(250);
  }assert(riskReady,'Risk service not ready');
  const {rows}=await db.pool.query("SELECT body FROM asset_index WHERE body->>'state'='IN_USE' ORDER BY id LIMIT 1");assert(rows[0]);const asset=rows[0].body;
  const value={sourceId:'lab-source',id,assetId:asset.id,measuredAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),sohBasisPoints:9820,cycleCount:300,simulation:true};
  const key=createPrivateKey(await readFile(path.join(runtime,'services/source-signing.key')));
  const signature=sign(null,Buffer.from(JSON.stringify(value)),key).toString('base64');
  const body={requestId:id,...value,signature};
  const imported=await call('lab-inspector','POST','/imports/health',body);assert.equal(imported.status,201);assert.equal(imported.body.stored,true);
  const replay=await call('lab-inspector','POST','/imports/health',body);assert.deepEqual(replay.body,imported.body);
  const allowed=await call('pack-operator','GET',`/batteries/${asset.code}/health`);assert.equal(allowed.status,200);assert.equal(allowed.body.sohBasisPoints,9820);assert.equal(allowed.body.cycleCount,300);assert.equal(allowed.body.remainingLifeEstimate,null);assert.equal(allowed.body.plannedScrapAt,null);
  const denied=await call('cell-viewer','GET',`/batteries/${asset.code}/health`);assert.equal(denied.status,403);
  const tampered=await call('lab-inspector','POST','/imports/health',{...body,requestId:id+'-tampered',cycleCount:0});assert.equal(tampered.status,400);assert.equal(tampered.body.code,'SOURCE_VERIFICATION_FAILED');
  const after=await call('pack-operator','GET',`/batteries/${asset.code}/health`);assert.equal(after.body.cycleCount,300);
  const report={network:'local',id,result:'PASS',assetId:asset.id,signedSnapshotStored:true,idempotentReplayVerified:true,unauthorizedReaderDenied:true,tamperingRejected:true,
    remainingLifeNotInvented:true,simulation:true,completedAt:new Date().toISOString()};
  await writeFile(path.join(root,'docs/reports',`health-verification-${id}.json`),JSON.stringify(report,null,2)+'\n');
  console.log('Signed health ingestion, permission checks, idempotency and tamper rejection PASS');
}catch(error){console.error('Health verification failed: '+error.message);process.exitCode=1;}
finally{for(const agent of agents)agent.destroy();await db.close();}
