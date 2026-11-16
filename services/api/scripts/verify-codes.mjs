import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ApiClient} from './api-client.mjs';
import {loadConfiguration,sha256} from '../dist/config.js';
import {FabricService} from '../dist/gateway.js';

const root=path.resolve(import.meta.dirname,'../../..'),api=new ApiClient();
const config=loadConfiguration(),fabric=new FabricService(config);
const identity=config.identities.find(i=>i.name==='pack-manufacturer');
assert(identity);
const runId='codes-'+randomUUID().slice(0,8);
const report={result:'PENDING',network:'local',channel:config.channel,runId,checks:[],transactions:[]};
let sequence=0;
const call=(who,method,route,body)=>api.call(who,method,route,body);
async function command(resource,data,errorCode){
  const result=await call('pack-manufacturer','POST','/commands/'+resource,{requestId:runId+'-'+sequence++,data});
  if(errorCode){assert.equal(result.body.stage,'rejected');assert.equal(result.body.errorCode,errorCode);}
  else{assert.equal(result.body.completed,true,JSON.stringify(result.body));assert.equal(result.body.stage,'ledger-verified');report.transactions.push({action:resource,txId:result.body.txId,stage:result.body.stage});}
  return result.body;
}
try{
  await api.ready();
  const sourceHash=sha256(await readFile(path.join(root,'docs/sources/GBT_34014-2017_with_amendment_1.pdf')));
  let example=await call('cell-viewer','GET','/codes/101PE052011A117AA0000100');
  assert.equal(example.status,200);assert.equal(example.body.validation,'CODE_FIELDS_VERIFIED');
  assert.equal(example.body.standardSourceHash,sourceHash);assert.equal(example.body.codeScope,'NEW_PRODUCT_24');
  assert.deepEqual(example.body.productionDateCode,{yearCode:'7',cycleFirstYear:2017,yearCycle:30,month:10,day:10,requiresSourceDate:true});
  report.checks.push('appendix-example-and-cyclic-year');
  for(const [code,chemistry] of Object.entries({A:'NIMH',B:'LFP',C:'LMO',D:'LCO',E:'TERNARY',F:'SUPERCAPACITOR',G:'LTO',H:'LMFP',J:'SODIUM_ION',Z:'OTHER'})){
    const parsed=await call('cell-viewer','GET','/codes/SIMP'+code+'01I0QSZ00G81A000001');
    assert.equal(parsed.status,200);assert.equal(parsed.body.chemistry,chemistry);
    assert.equal(parsed.body.traceCode,'I0QSZ00');assert.equal(parsed.body.additionalSpecCodeCandidate,'I');
  }
  report.checks.push('all-ten-materials-alphanumeric-serial-and-optional-X8');
  for(const code of ['SIMPI010000001G110000001','SIMPB010000001G400000001','SIMPB010000001K2X0000001','201MC038800002000RM']){
    const invalid=await call('cell-viewer','GET','/codes/'+code);assert.equal(invalid.status,400);
  }
  const futureLeap=await call('cell-viewer','GET','/codes/SIMPB010000001G2X0000001');
  assert.equal(futureLeap.status,200);assert.equal(futureLeap.body.productionDateCode.requiresSourceDate,true);
  report.checks.push('invalid-calendar-and-out-of-scope-rejected-without-unique-year-inference');
  const makers='DMA';
  const registered=await call('pack-viewer','GET','/makers/'+makers);
  assert.equal(registered.status,200);assert.equal(registered.body.simulation,true);
  const serial=runId.slice(6).toUpperCase().slice(0,7);
  const data={id:runId+'-pack',code:makers+'PJ01'+'0000001'+'G81'+serial,batchId:'',model:'sim-sodium-ion',manufacturedAt:'2026-08-01',manufactureSourceHash:sha256('explicit simulated source date'),designLifeMonths:null,specSourceHash:''};
  await command('assets',data);
  const before=(await call('pack-viewer','GET','/assets/'+data.id)).body;
  assert.equal(before.chemistry,'SODIUM_ION');assert.equal(before.manufacturedAt,'2026-08-01');assert.equal(before.simulation,true);
  for(const [suffix,change,errorCode] of [
    ['mismatch',{manufacturedAt:'2026-08-02'},'CODE_DATE_MISMATCH'],
    ['pre-amendment-material',{manufacturedAt:'2026-07-31',code:makers+'PJ01'+'0000001'+'G70'+'0000001'},'CODE_CHEMISTRY'],
    ['pre-amendment-serial',{manufacturedAt:'2026-07-31',code:makers+'PB01'+'0000001'+'G70'+'A000001'},'CODE_SERIAL'],
  ]){
    const rejectedId=runId+'-'+suffix;
    await command('assets',{...data,...change,id:rejectedId},errorCode);
    assert.deepEqual((await call('pack-viewer','GET','/assets/'+data.id)).body,before);
    const absent=await call('pack-viewer','GET','/assets/'+rejectedId);assert.equal(absent.status,400);assert.equal(absent.body.code,'NOT_FOUND');
  }
  report.checks.push('new-registration-source-date-edition-gates-and-rejected-state-unchanged');
  const formal=await call('pack-admin','POST','/commands/makers',{requestId:runId+'-formal',data:{code:'FOR',name:'No enterprise proof',msp:'PackOrgMSP',simulation:false,sourceHash:sha256('not real credentials')}});
  assert.equal(formal.body.stage,'rejected');assert.equal(formal.body.errorCode,'INVALID_MAKER');
  report.checks.push('formal-registration-stays-disabled');
  const original=JSON.parse(await readFile(path.join(root,'docs/reports/business-demo-demo-bc010168.json'),'utf8'));
  for(const sample of original.samples){
    const historical=await call('cell-viewer','GET','/batteries/'+sample.code);
    assert.equal(historical.status,200);assert.equal(historical.body.id,sample.id);assert.equal(historical.body.code,sample.code);
    assert.equal(historical.body.simulation,true);
  }
  report.checks.push('existing-provisional-records-still-readable');
  report.definition=await fabric.definition(identity);assert.equal(report.definition.version,'1.3');assert.equal(report.definition.sequence,'4');
  report.sourceHash=sourceHash;report.standardVersion=example.body.standardVersion;
  report.fourPeerVerification=true;report.result='PASS';report.completedAt=new Date().toISOString();
  await writeFile(path.join(root,'docs/reports/code-standard-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Standard coding: ten materials, cyclic dates, source-date consistency, amendment gates, legacy reads and local four-peer registration PASS');
}catch(error){console.error('Code standard verification failed: '+error.message);process.exitCode=1;}
finally{api.close();await fabric.close();}
