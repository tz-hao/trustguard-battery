import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { AiService, aiRequestSchema } from './ai.js';
import { aiError, type AiConfig, type Evidence } from './deepseek.js';
import type { AiRow, AnalysisStore } from './ai-store.js';
import type { Database } from './database.js';
import type { FabricService } from './gateway.js';
import type { AuthenticatedActor, Asset } from './types.js';

export class MemoryAiStore implements AnalysisStore {
  rows=new Map<string,AiRow>();
  async get(actor:string,request:string){return this.rows.get(actor+':'+request);}
  async reserve(actor:string,request:string,asset:string,digest:string){
    const key=actor+':'+request;if(this.rows.has(key))return false;
    this.rows.set(key,{actor_hash:actor,request_id:request,asset_id:asset,payload_hash:digest,state:'running',result:null,error_code:null,created_at:new Date()});return true;
  }
  async complete(actor:string,request:string,result:Record<string,unknown>){Object.assign(this.rows.get(actor+':'+request)!,{state:'completed',result});}
  async fail(actor:string,request:string,code:string){Object.assign(this.rows.get(actor+':'+request)!,{state:'failed',error_code:code});}
}
const config: AiConfig={enabled:true,apiKey:'test-only-not-real',model:'deepseek-flash',timeoutMs:1000,maxTokens:2500,allowRealData:false};
const actor={actorHash:'actor-1',identity:{mspId:'PackOrgMSP',role:'operator'}} as AuthenticatedActor;
const input={requestId:'request-1',assetId:'confidential-pack-id',task:'risk_explanation'};
const rejects=(code:string)=>(e:unknown)=>e instanceof HttpException&&(e.getResponse() as {code:string}).code===code;
function fixture(){
  let calls=0;let captured:Evidence[]=[];
  const store=new MemoryAiStore();const audit:{outcome:string}[]=[];
  const asset={id:input.assetId,code:'CONFIDENTIAL-CODE',type:'PACK',makerCode:'SECRET-MAKER',makerMSP:'PackOrgMSP',holderMSP:'PackOrgMSP',
    chemistry:'LFP',model:'secret-model',simulation:true,manufacturedAt:'2026-01-01',state:'REGISTERED',quality:'NOT_TESTED',version:1,assemblyVersion:0,children:[],inspectionVersion:0,
    installedAt:null,firstUseAt:null,retiredAt:null,scrappedAt:null,txId:'private-tx'} as unknown as Asset;
  let snapshotHash='snapshot-1';let policyVersion=3;let riskRows:unknown[]=[];
  const fabric={async query(_identity:unknown,kind:string){
    if(kind==='asset')return structuredClone(asset);
    if(kind==='snapshot')return {hash:snapshotHash,assets:[structuredClone(asset)]};
    if(kind==='inspections')return [{assetId:asset.id,version:1,result:'QC_REJECTED',at:'2026-01-01',id:'report-private',txId:'private-inspection-tx'}];
    if(kind==='policy')return {version:policyVersion};throw new Error('Unexpected or mutating Fabric call');
  }} as unknown as FabricService;
  const db={pool:{async query(sql:string){assert(sql.startsWith('SELECT'));return {rows:riskRows};}}} as unknown as Database;
  const provider={async analyze(_config:AiConfig,_task:string,_question:string|undefined,evidence:Evidence[]){
    calls++;captured=evidence;
    return {analysis:{summary:{text:'需要复核',evidenceIds:['E1']},findings:[],reviewSuggestions:[],unknowns:[]},model:'deepseek-flash',usage:null};
  }};
  const recorder={async record(_actor:string,_id:string|null,_action:string,outcome:string){audit.push({outcome});}};
  const service=new AiService(db,fabric,recorder,provider,()=>config,store);
  return {service,asset,store,provider,db,fabric,recorder,audit,get calls(){return calls;},get captured(){return captured;},
    setSnapshot:(value:string)=>{snapshotHash=value;},setPolicy:(value:number)=>{policyVersion=value;},setRisks:(rows:unknown[])=>{riskRows=rows;}};
}

test('current holder analysis is advisory, minimized, durable and idempotent',async()=>{
  const f=fixture();const response=await f.service.analyze(actor,input);
  assert.equal(response.completed,true);assert.equal(response.advisoryOnly,true);assert.equal(response.stale,false);
  const prompt=JSON.stringify(f.captured);
  for(const value of ['CONFIDENTIAL-CODE','SECRET-MAKER','private-tx','secret-model',input.assetId])assert(!prompt.includes(value));
  assert(f.captured.some(e=>e.kind==='missing'));
  const again=await f.service.analyze(actor,input);assert.deepEqual(again,response);assert.equal(f.calls,1);
  await assert.rejects(f.service.analyze(actor,{...input,task:'trace_question',question:'为什么?'}),rejects('IDEMPOTENCY_CONFLICT'));
  const result=response.result as Record<string,unknown>;assert.equal(result.remainingLifeEstimate,null);assert.equal(result.humanReviewRequired,true);
  assert(f.audit.some(a=>a.outcome.startsWith('VALIDATED:')));
});

test('cited current inspection resolves to its report and transaction only inside the workbench',async()=>{
  const f=fixture();f.asset.inspectionVersion=1;
  const response=await f.service.analyze(actor,input);
  const record=f.captured.find(e=>e.kind==='inspection')!;
  assert.equal(record.facts.result,'QC_REJECTED');
  assert(!JSON.stringify(f.captured).includes('report-private'));
  const result=response.result as {references:{evidenceId:string;resourceId:string;txId?:string}[]};
  assert(result.references.some(r=>r.evidenceId===record.id && r.resourceId==='report-private' && r.txId==='private-inspection-tx'));
});

test('cross-organization, viewer and lab non-review roles are denied before disclosure',async()=>{
  const f=fixture();
  for(const identity of [{mspId:'CellOrgMSP',role:'operator'},{mspId:'PackOrgMSP',role:'viewer'},{mspId:'LabOrgMSP',role:'release'}]){
    await assert.rejects(f.service.analyze({...actor,identity:identity as AuthenticatedActor['identity']},input),rejects('FORBIDDEN'));
  }
  assert.equal(f.calls,0);assert.equal(f.store.rows.size,0);
});

test('result reads and cached requests recheck custody and cannot cross requester identities',async()=>{
  const f=fixture();await f.service.analyze(actor,input);
  await assert.rejects(f.service.get({...actor,actorHash:'another-actor'},input.requestId),rejects('NOT_FOUND'));
  f.asset.holderMSP='RecycleOrgMSP';
  await assert.rejects(f.service.get(actor,input.requestId),rejects('FORBIDDEN'));
  await assert.rejects(f.service.analyze(actor,input),rejects('FORBIDDEN'));assert.equal(f.calls,1);
});

test('missing configuration and real data gate produce no provider call or request reservation',async()=>{
  const f=fixture();const unconfigured=new AiService(f.db,f.fabric,f.recorder,f.provider,()=>({...config,apiKey:''}),f.store);
  await assert.rejects(unconfigured.analyze(actor,input),rejects('AI_NOT_CONFIGURED'));
  assert.equal(unconfigured.status().available,false);assert(!JSON.stringify(unconfigured.status()).includes(config.apiKey));
  f.asset.simulation=false;await assert.rejects(f.service.analyze(actor,input),rejects('AI_REAL_DATA_DISABLED'));
  assert.equal(f.calls,0);assert.equal(f.store.rows.size,0);
});

test('changed evidence during generation discards output and never re-sends failed requests',async()=>{
  const f=fixture();const original=f.provider.analyze;
  f.provider.analyze=async(...args)=>{const generated=await original(...args);f.setSnapshot('snapshot-2');return generated;};
  await assert.rejects(f.service.analyze(actor,input),rejects('AI_EVIDENCE_CHANGED'));
  const state=await f.service.get(actor,input.requestId);assert.equal(state.state,'failed');assert.equal(state.result,undefined);
  assert.equal((await f.service.analyze(actor,input)).state,'failed');assert.equal(f.calls,1);
});

test('stale risk evidence is labeled and cached results expose later policy changes',async()=>{
  const f=fixture();f.setRisks([{id:'risk-private',snapshot_hash:'old-snapshot',policy_version:'2',body:{level:'HIGH',evidenceHash:'a'.repeat(64),
    issuedAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-01T00:05:00Z',modelVersion:'iforest-v1',signature:'must-not-leak',review:{missingMeasurements:1,qualityRules:['MISSING'],operationRules:[]}}}]);
  await f.service.analyze(actor,input);const risk=f.captured.find(e=>e.kind==='risk')!;assert.equal(risk.facts.stale,true);assert(!JSON.stringify(risk).includes('must-not-leak'));
  f.setPolicy(4);assert.equal((await f.service.get(actor,input.requestId)).stale,true);
});

test('concurrent same request sends once and an interrupted request is never automatically retried',async()=>{
  const f=fixture();let unblock!:()=>void;const block=new Promise<void>(resolve=>{unblock=resolve;});const original=f.provider.analyze;
  f.provider.analyze=async(...args)=>{const result=await original(...args);await block;return result;};
  const first=f.service.analyze(actor,input);
  while(f.calls===0)await new Promise(resolve=>setTimeout(resolve,1));
  const repeated=await f.service.analyze(actor,input);assert.equal(repeated.state,'running');assert.equal(f.calls,1);
  unblock();await first;
  const row=await f.store.get(actor.actorHash,input.requestId);row!.state='running';row!.created_at=new Date(Date.now()-130000);
  assert.equal((await f.service.analyze(actor,input)).state,'interrupted');assert.equal(f.calls,1);
});

test('timeout and provider errors are persistent failures; strict request schema rejects identity injection',async()=>{
  const f=fixture();f.provider.analyze=async()=>{throw aiError('AI_TIMEOUT',504);};
  await assert.rejects(f.service.analyze(actor,input),rejects('AI_TIMEOUT'));
  assert.equal((await f.service.get(actor,input.requestId)).errorCode,'AI_TIMEOUT');
  assert.throws(()=>aiRequestSchema.parse({...input,actor:{role:'admin'}}));
  assert.throws(()=>aiRequestSchema.parse({...input,task:'trace_question'}));
  assert.throws(()=>aiRequestSchema.parse({...input,task:'trace_question',question:'api_key=secret'}));
  assert.throws(()=>aiRequestSchema.parse({...input,question:'unused text'}));
  assert.equal(aiRequestSchema.parse({...input,task:'trace_question',question:'为什么不能放行？'}).task,'trace_question');
});
