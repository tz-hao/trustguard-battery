import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {loadConfiguration,sha256} from '../dist/config.js';
import {FabricService} from '../dist/gateway.js';
import {Database} from '../dist/database.js';
import {TransactionService,safeErrorCode} from '../dist/transactions.js';

const root=path.resolve(import.meta.dirname,'../../..'),runtime=path.dirname(process.env.TRUSTGUARD_IDENTITIES_FILE);
const name='security-'+randomUUID().slice(0,8),execute=promisify(execFile),agents=[];
const config=loadConfiguration(),fabric=new FabricService(config),db=new Database(config.databaseUrl),restores=new Set();
const report={network:'local',channel:config.channel,name,checks:[]};
const python=path.join(root,'.venv/bin/python');
async function service(action,who){await execute(python,[path.join(root,'infrastructure/scripts/business_services.py'),action,'--service',who],{cwd:root,env:process.env});}
async function request(port,route,certFile,keyFile,body){
  const agent=new https.Agent({ca:await readFile(path.join(runtime,'server-ca/ca.crt')),cert:certFile?await readFile(certFile):undefined,key:keyFile?await readFile(keyFile):undefined,rejectUnauthorized:true});agents.push(agent);
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const req=https.request(`https://localhost:${port}${route}`,{method:payload?'POST':'GET',agent,timeout:30000,headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks),type:response.headers['content-type']}));});
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('SECURITY_PROBE_TIMEOUT')));req.end(payload);
  });
}
async function api(who,route,body){const [org,role]=who.split('-'),base=path.join(runtime,'organizations',org,'users',role);return request(13000,'/api/v1'+route,path.join(base,'api.crt'),path.join(base,'api.key'),body);}
async function ready(){for(let i=0;i<60;i++){try{const r=await api('cell-viewer','/health');if(r.status===200)return;}catch{}await delay(250);}throw new Error('API_NOT_READY');}
async function transportDenied(port,route,cert,key){
  await assert.rejects(request(port,route,cert,key),error=>['EPROTO','ECONNRESET','ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED','ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED','ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED'].includes(error.code)||String(error.code).startsWith('ERR_SSL_'));
}
try{
  await execute(python,[path.join(root,'infrastructure/scripts/security_certificates.py'),'prepare',name],{cwd:root});
  const fixture=path.join(runtime,'security',name);
  await ready();
  let riskReady=false;
  for(let i=0;i<60;i++){
    try{const response=await request(18000,'/health',process.env.TRUSTGUARD_WORKLOAD_CERT,process.env.TRUSTGUARD_WORKLOAD_KEY);if(response.status===200){riskReady=true;break;}}
    catch(error){if(!['ECONNREFUSED','ECONNRESET'].includes(error.code))throw error;}
    await delay(250);
  }
  assert(riskReady,'Risk service not ready');
  await transportDenied(13000,'/api/v1/health');report.checks.push({name:'API requires client certificate',passed:true});
  await transportDenied(18000,'/health');report.checks.push({name:'Risk service requires Gateway workload certificate',passed:true});
  await transportDenied(13000,'/api/v1/health',path.join(fixture,'expired-client.crt'),path.join(fixture,'expired-client.key'));report.checks.push({name:'Expired TLS certificate rejected',passed:true});
  const trustedBefore=await request(13000,'/api/v1/health',path.join(fixture,'revoked-client.crt'),path.join(fixture,'revoked-client.key'));
  assert.equal(trustedBefore.status,403); // TLS accepted; application deliberately has no mapping for this disposable identity.
  await execute(python,[path.join(root,'infrastructure/scripts/security_certificates.py'),'revoke',name],{cwd:root});
  await service('restart','api');await ready();
  await transportDenied(13000,'/api/v1/health',path.join(fixture,'revoked-client.crt'),path.join(fixture,'revoked-client.key'));report.checks.push({name:'Revoked TLS certificate rejected during handshake',passed:true});
  const lab=config.identities.find(i=>i.name==='lab-inspector');
  const expired={...lab,name:name+'-expired-lab',certificateFile:path.join(fixture,'expired-inspector.crt'),privateKeyFile:path.join(fixture,'expired-inspector.key')};
  const proposal=await fabric.proposal(expired,{requestId:name+'-expired-enrollment',action:'SubmitInspection',data:{id:name+'-invalid-inspection',assetId:'nonexistent-security-target',version:1,result:'QC_PASSED',reportHash:sha256('test'),sourceHash:sha256('test')}});
  await assert.rejects(proposal.endorse(),error=>safeErrorCode(error)==='UNAUTHENTICATED');report.checks.push({name:'Expired Fabric enrollment cannot sign inspection',passed:true});
  await service('stop','risk');restores.add('risk');
  const blocked=await api('pack-release','/commands/release-finalizations',{requestId:name+'-unavailable-risk',data:{id:'nonexistent-security-release'}});
  assert.equal(blocked.status,503);assert.equal(JSON.parse(blocked.body).code,'RISK_UNAVAILABLE');report.checks.push({name:'Risk outage pauses finalize gateway before transaction submission',passed:true});
  await service('start','risk');restores.delete('risk');
  const existing=await db.pool.query('SELECT id,plaintext_hash FROM reports ORDER BY created_at LIMIT 1');assert(existing.rows[0]);
  const reportId=existing.rows[0].id;
  const good=await api('lab-inspector',`/reports/${reportId}/content`);assert.equal(good.status,200);assert.equal(sha256(good.body),existing.rows[0].plaintext_hash);
  await service('stop','broker');restores.add('broker');
  const noKey=await api('lab-inspector',`/reports/${reportId}/content`);assert.equal(noKey.status,503);assert(noKey.type.includes('application/json'));report.checks.push({name:'Key broker outage yields no plaintext',passed:true});
  await service('start','broker');restores.delete('broker');
  for(let i=0;i<40;i++){try{const recovered=await api('lab-inspector',`/reports/${reportId}/content`);if(recovered.status===200){assert.equal(sha256(recovered.body),existing.rows[0].plaintext_hash);break;}if(i===39)throw new Error('BROKER_NOT_RECOVERED');}catch(error){if(i===39)throw error;}await delay(250);}
  const auditor=config.identities.find(i=>i.name==='lab-auditor');
  const actor={identity:auditor,actorHash:sha256(auditor.mspId+':'+auditor.clientFingerprint)},transactions=new TransactionService(db,fabric);
  const command={requestId:name+'-uncertain',action:'AnchorAudit',data:{id:name+'-anchor',digest:sha256('uncertain observation recovery test'),count:1}};
  const verifyOriginal=fabric.verifyCommitted.bind(fabric);fabric.verifyCommitted=async()=>{throw new Error('SIMULATED_POST_COMMIT_OBSERVATION_TIMEOUT');};
  const uncertain=await transactions.execute(actor,command);assert.equal(uncertain.stage,'unknown');assert.equal(uncertain.completed,false);
  fabric.verifyCommitted=verifyOriginal;
  const beforeHeight=await fabric.height(auditor);
  const duplicate=await transactions.execute(actor,command);assert.equal(duplicate.txId,uncertain.txId);
  const recovered=await transactions.status(actor,command.requestId);assert.equal(recovered.stage,'ledger-verified');assert.equal(recovered.txId,uncertain.txId);assert.equal(await fabric.height(auditor),beforeHeight);
  report.checks.push({name:'Post-commit observation failure reconciles by original txId without resubmission',passed:true});
  report.result='PASS';report.completedAt=new Date().toISOString();
  await writeFile(path.join(root,'docs/reports',`security-verification-${name}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(`Local certificate, dependency outage and uncertain-transaction recovery PASS; ${report.checks.length} checks`);
}catch(error){report.result='FAIL';report.failure=error.message;await writeFile(path.join(root,'docs/reports',`security-verification-${name}.json`),JSON.stringify(report,null,2)+'\n');console.error('Security verification stopped: '+error.message);process.exitCode=1;}
finally{for(const who of restores)await service('start',who);for(const agent of agents)agent.destroy();await fabric.close();await db.close();}
