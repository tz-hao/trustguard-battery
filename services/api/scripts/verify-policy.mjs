import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicKey,verify,randomUUID} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {canonicalJson,sha256} from '../dist/config.js';

const runtime=path.dirname(process.env.TRUSTGUARD_IDENTITIES_FILE),id='policy-check-'+randomUUID().slice(0,8),agents=[];
let sequence=0;
async function call(who,method,route,body){
  const [org,role]=who.split('-'),base=path.join(runtime,'organizations',org,'users',role);
  const agent=new https.Agent({cert:await readFile(path.join(base,'api.crt')),key:await readFile(path.join(base,'api.key')),ca:await readFile(path.join(runtime,'server-ca/ca.crt'))});agents.push(agent);
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const request=https.request('https://localhost:13000/api/v1'+route,{method,agent,timeout:90000,headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}},response=>{
      const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});
    request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('POLICY_CHECK_TIMEOUT')));request.end(payload);
  });
}
async function command(who,resource,data){const response=await call(who,'POST','/commands/'+resource,{requestId:id+'-'+sequence++,data});assert.equal(response.body.completed,true,resource+':'+response.body.errorCode);return response.body;}
try{
  let active;
  for(let i=0;i<40;i++){try{const r=await call('cell-admin','GET','/policies/current');if(r.status===200){active=r.body;break;}}catch(e){if(e.code!=='ECONNREFUSED')throw e;}await delay(250);}
  assert(active,'API not ready');
  const candidate={id,policy:{...active,version:active.version+1}};
  const preview=await call('cell-admin','POST','/policies/previews',candidate);
  assert.equal(preview.status,201);assert.equal(preview.body.report.passed,true);
  assert.equal(preview.body.testsHash,sha256(canonicalJson(preview.body.report)));
  const publicKey=createPublicKey(await readFile(path.join(runtime,'services/audit-signing.pub')));
  assert(verify(null,Buffer.from(preview.body.testsHash,'hex'),publicKey,Buffer.from(preview.body.signature,'base64')));
  const replay=await call('cell-admin','POST','/policies/previews',candidate);assert.deepEqual(replay.body,preview.body);
  const proposed=await command('cell-admin','policy-candidates',{...candidate,testsHash:preview.body.testsHash});
  const approvals=[];for(const who of ['cell-auditor','pack-auditor','lab-auditor'])approvals.push(await command(who,'policy-approvals',{id}));
  const insufficient=await call('cell-admin','POST','/commands/policy-activations',{requestId:id+'-insufficient',data:{id}});
  assert.equal(insufficient.body.stage,'rejected');assert.equal(insufficient.body.errorCode,'APPROVALS_MISSING');
  approvals.push(await command('recycle-auditor','policy-approvals',{id}));
  const activated=await command('cell-admin','policy-activations',{id});
  const after=await call('cell-admin','GET','/policies/current');assert.equal(after.body.version,active.version+1);
  const report={network:'local',channel:process.env.TRUSTGUARD_CHANNEL,id,result:'PASS',baseVersion:active.version,activeVersion:after.body.version,
    preview:preview.body,proposalTx:proposed.txId,approvalTxs:approvals.map(a=>a.txId),activationTx:activated.txId,
    insufficientApprovalsBlocked:true,signatureVerified:true,completedAt:new Date().toISOString()};
  await writeFile(path.resolve(import.meta.dirname,'../../../docs/reports',`policy-verification-${id}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(`Local policy preview, signed evidence, four-organization approval and activation PASS; active version ${after.body.version}`);
}catch(error){console.error('Policy verification failed: '+error.message);process.exitCode=1;}
finally{for(const agent of agents)agent.destroy();}
