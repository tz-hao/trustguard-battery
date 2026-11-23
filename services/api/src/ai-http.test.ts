import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AddressInfo } from 'node:net';
import { AiController } from './ai-controller.js';
import { AiService } from './ai.js';
import { DeepSeekProvider } from './deepseek.js';
import type { AnalysisStore,AiRow } from './ai-store.js';
import type { Database } from './database.js';
import type { FabricService } from './gateway.js';

// Explicit offline HTTP harness. Production authentication remains mTLS in main.ts.
// Nothing in this test starts the production server or submits Fabric transactions.
test('HTTP routes, grounded question, replay and OpenAPI work with explicit offline dependencies',async()=>{
  let providerCalls=0;let hasKey=true;
  const rows=new Map<string,AiRow>();
  const store:AnalysisStore={
    async get(actor,req){return rows.get(actor+req);},
    async reserve(actor,req,asset,digest){if(rows.has(actor+req))return false;rows.set(actor+req,{actor_hash:actor,request_id:req,asset_id:asset,payload_hash:digest,state:'running',result:null,error_code:null,created_at:new Date()});return true;},
    async complete(actor,req,result){Object.assign(rows.get(actor+req)!,{state:'completed',result});},
    async fail(actor,req,error){Object.assign(rows.get(actor+req)!,{state:'failed',error_code:error});},
  };
  const asset={id:'pack-test',code:'private-code',holderMSP:'PackOrgMSP',type:'PACK',chemistry:'LFP',quality:'NOT_TESTED',state:'REGISTERED',simulation:true,version:1,children:[],inspectionVersion:0,manufacturedAt:'2026-01-01',txId:'private-tx'};
  const fabric={async query(_i:unknown,kind:string){return kind==='asset'?asset:kind==='snapshot'?{hash:'snapshot',assets:[asset]}:{version:1};}} as unknown as FabricService;
  const db={pool:{async query(){return {rows:[]};}}} as unknown as Database;
  const provider=new DeepSeekProvider(async(_url,options)=>{
    providerCalls++;const request=JSON.parse(String(options?.body));const context=JSON.parse(request.messages[1].content);
    assert.equal(context.task,'trace_question');assert.equal(context.question,'为什么需要复核？');assert(!String(options?.body).includes('private-code'));
    return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:{text:'缺少检测证据，需要人工复核。',evidenceIds:['E1','E2']},findings:[],reviewSuggestions:[],unknowns:['缺少检测结果']})}}]});
  });
  const service=new AiService(db,fabric,{async record(){}},provider,()=>({enabled:true,apiKey:hasKey?'test-only-not-real':'',model:'deepseek-flash',timeoutMs:1000,maxTokens:2500,allowRealData:false}),store);
  @Module({controllers:[AiController],providers:[{provide:AiService,useValue:service}]})class TestModule{}
  const app=await NestFactory.create<NestExpressApplication>(TestModule,{logger:false});
  app.use((req:{actor?:unknown;headers:Record<string,string>},_res:unknown,next:()=>void)=>{
    req.actor={actorHash:'test-actor',identity:{mspId:'PackOrgMSP',role:req.headers['test-role']??'operator'}};next();
  });
  await app.listen(0,'127.0.0.1');
  const base='http://127.0.0.1:'+(app.getHttpServer().address() as AddressInfo).port+'/api/v1/ai';
  const body={requestId:'http-1',assetId:'pack-test',task:'trace_question',question:'为什么需要复核？'};
  try{
    const status=await fetch(base+'/status');assert.equal(status.status,200);assert.equal((await status.json()).connectivityVerified,false);
    const response=await fetch(base+'/analyses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,201);const first=await response.json();assert.equal(first.completed,true);assert.equal(first.result.analysis.summary.evidenceIds[0],'E1');
    const get=await fetch(base+'/analyses/http-1');assert.deepEqual(await get.json(),first);
    const replay=await fetch(base+'/analyses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.deepEqual(await replay.json(),first);assert.equal(providerCalls,1);
    const forbidden=await fetch(base+'/analyses/http-1',{headers:{'test-role':'viewer'}});assert.equal(forbidden.status,403);
    hasKey=false;
    const missing=await fetch(base+'/analyses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,requestId:'http-2'})});
    assert.equal(missing.status,503);assert.deepEqual(await missing.json(),{code:'AI_NOT_CONFIGURED'});assert.equal(providerCalls,1);
    const spec=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('offline AI test').build());
    for(const route of ['/api/v1/ai/status','/api/v1/ai/analyses','/api/v1/ai/analyses/{requestId}'])assert(spec.paths[route]);
  }finally{await app.close();}
});