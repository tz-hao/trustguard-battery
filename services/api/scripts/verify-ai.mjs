import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ApiClient} from './api-client.mjs';

// Default is configuration-only. --live deliberately opts into a billed external
// DeepSeek call and a stored advisory record, never a Fabric transaction.
const args=process.argv.slice(2),live=args.includes('--live'),assetIndex=args.indexOf('--asset');
const assetId=assetIndex>=0?args[assetIndex+1]:undefined;
const whoIndex=args.indexOf('--identity'),who=whoIndex>=0?args[whoIndex+1]:'pack-operator';
if(live&&(!assetId||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(assetId)))throw new Error('Use --live --asset <authorized simulated asset ID>');
const api=new ApiClient();
try{
  const status=await api.call(who,'GET','/ai/status');assert.equal(status.status,200);assert.equal(status.body.provider,'deepseek');
  console.log(JSON.stringify({mode:live?'live':'configuration-only',enabled:status.body.enabled,configured:status.body.configured,reason:status.body.reason,connectivityVerified:false}));
  if(live){
    assert.equal(status.body.available,true,'AI is not configured and enabled');
    const requestId='ai-live-'+randomUUID();
    const body={requestId,assetId,task:'risk_explanation'};
    const generated=await api.call(who,'POST','/ai/analyses',body);
    assert.equal(generated.status,201);assert.equal(generated.body.completed,true);assert.equal(generated.body.advisoryOnly,true);
    const ids=new Set(generated.body.result.references.map(r=>r.evidenceId));
    for(const claim of [generated.body.result.analysis.summary,...generated.body.result.analysis.findings,...generated.body.result.analysis.reviewSuggestions])assert(claim.evidenceIds.every(id=>ids.has(id)));
    const replay=await api.call(who,'POST','/ai/analyses',body);assert.deepEqual(replay.body,generated.body);
    const fetched=await api.call(who,'GET','/ai/analyses/'+requestId);assert.deepEqual(fetched.body,generated.body);
    console.log(JSON.stringify({result:'PASS',mode:'live',requestId,provider:'deepseek',model:generated.body.result.model,citationsVerified:true,semanticAccuracyVerified:false,ledgerTransactionsSent:0}));
  }
}catch(error){
  // Do not print upstream responses, prompts, generated reports or key material.
  console.error('AI verification failed; check service availability, authorized asset and private configuration.');process.exitCode=1;
}finally{api.close();}