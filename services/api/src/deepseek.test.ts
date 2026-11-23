import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { DeepSeekProvider, loadAiConfig, validateAnalysis, type AiConfig, type Evidence } from './deepseek.js';

const config: AiConfig = { enabled:true, apiKey:'test-only-not-a-real-key', model:'deepseek-flash', timeoutMs:1000, maxTokens:2500, allowRealData:false };
const evidence: Evidence[] = [{id:'E1',kind:'asset',facts:{quality:'QC_REJECTED',simulation:true}}];
const analysis = {summary:{text:'需要复核质检结果。',evidenceIds:['E1']},findings:[],reviewSuggestions:[],unknowns:[]};
const envelope = (content = JSON.stringify(analysis), finish = 'stop') => ({ model:'deepseek-flash',choices:[{finish_reason:finish,message:{content}}],usage:{prompt_tokens:50,completion_tokens:30,total_tokens:80} });
const rejects = (code:string) => (error:unknown) => error instanceof HttpException && (error.getResponse() as {code:string}).code === code;
const transport = (fn: (url: string | URL | Request, options?: RequestInit) => Promise<Response>) => fn as typeof fetch;

test('DeepSeek configuration has an explicit disabled mode and safe bounds', () => {
  const disabled = loadAiConfig({});
  assert.equal(disabled.enabled,false);assert.equal(disabled.apiKey,'');assert.equal(disabled.model,'deepseek-flash');
  assert.throws(()=>loadAiConfig({TRUSTGUARD_AI_TIMEOUT_MS:'0'}),rejects('AI_CONFIGURATION_INVALID'));
  assert.throws(()=>loadAiConfig({DEEPSEEK_MODEL:'bad/model'}),rejects('AI_CONFIGURATION_INVALID'));
  assert.throws(()=>loadAiConfig({DEEPSEEK_API_KEY:'abc\r\nInjected:value'}),rejects('AI_CONFIGURATION_INVALID'));
});

test('official JSON protocol uses bounded input, no tools or redirects, and validates references', async () => {
  let calls=0;
  const provider=new DeepSeekProvider(transport(async (url, options) => {
    calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options?.redirect,'error');
    const body=JSON.parse(String(options?.body));
    assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.stream,false);assert.equal(body.max_tokens,2500);
    assert.equal(body.tools,undefined);assert.equal(body.thinking.type,'disabled');
    assert(!String(options?.body).includes(config.apiKey));assert.equal(body.messages[1].role,'user');
    return Response.json(envelope());
  }));
  const result=await provider.analyze(config,'risk_explanation',undefined,evidence);
  assert.deepEqual(result.analysis,analysis);assert.equal(result.usage?.totalTokens,80);assert.equal(calls,1);
});

test('missing key and disabled configuration never call transport', async () => {
  let calls=0;const provider=new DeepSeekProvider(transport(async()=>{calls++;return Response.json(envelope());}));
  await assert.rejects(provider.analyze({...config,enabled:false},'risk_explanation',undefined,evidence),rejects('AI_DISABLED'));
  await assert.rejects(provider.analyze({...config,apiKey:''},'risk_explanation',undefined,evidence),rejects('AI_NOT_CONFIGURED'));
  assert.equal(calls,0);
});

test('blank, truncated, malformed and unsupported authority outputs are rejected',async()=>{
  for(const response of [envelope('   '),envelope('{bad'),envelope(JSON.stringify(analysis),'length'),
    envelope(JSON.stringify({...analysis,approved:true})),envelope(JSON.stringify({...analysis,summary:{text:'无证据',evidenceIds:[]}})),
    {...envelope(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis),tool_calls:[{name:'release'}]}}]}]){
    const provider=new DeepSeekProvider(transport(async()=>Response.json(response)));
    await assert.rejects(provider.analyze(config,'risk_explanation',undefined,evidence),rejects('AI_INVALID_OUTPUT'));
  }
  assert.throws(()=>validateAnalysis({...analysis,summary:{text:'编造引用',evidenceIds:['E999']}},evidence),rejects('AI_UNKNOWN_EVIDENCE'));
});

test('provider failures are sanitized and never automatically retried',async()=>{
  for(const [status,code] of [[401,'AI_PROVIDER_AUTH_FAILED'],[402,'AI_PROVIDER_BALANCE_REQUIRED'],[429,'AI_PROVIDER_RATE_LIMITED'],[500,'AI_PROVIDER_UNAVAILABLE']] as const){
    let calls=0;
    const provider=new DeepSeekProvider(transport(async()=>{calls++;return new Response('private upstream details',{status});}));
    await assert.rejects(provider.analyze(config,'risk_explanation',undefined,evidence),rejects(code));assert.equal(calls,1);
  }
  const broken=new DeepSeekProvider(transport(async()=>{throw new Error('secret request header');}));
  await assert.rejects(broken.analyze(config,'risk_explanation',undefined,evidence),rejects('AI_PROVIDER_UNAVAILABLE'));
});

test('timeout aborts and oversized responses cannot consume unbounded memory',async()=>{
  const stalled=new DeepSeekProvider(transport(async(_url,options)=>new Promise((_resolve,reject)=>{
    options?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  })));
  await assert.rejects(stalled.analyze({...config,timeoutMs:15},'risk_explanation',undefined,evidence),rejects('AI_TIMEOUT'));
  const large=new DeepSeekProvider(transport(async()=>new Response('x'.repeat(128001))));
  await assert.rejects(large.analyze(config,'risk_explanation',undefined,evidence),rejects('AI_RESPONSE_TOO_LARGE'));
  await assert.rejects(large.analyze(config,'trace_question','x'.repeat(50000),evidence),rejects('AI_CONTEXT_TOO_LARGE'));
});