import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { AiStore } from './ai-store.js';
import type { Database } from './database.js';

function fixture({exists=false,running=0,recent=0,insertError=false,limit=undefined as string|undefined}={}){
  const calls:{sql:string;args?:unknown[]}[]=[];let released=false;
  const client={async query(sql:string,args?:unknown[]){
    calls.push({sql,args});
    if(sql.startsWith('SELECT 1'))return {rowCount:exists?1:0,rows:[]};
    if(sql.includes(' AS used')){assert(sql.includes("date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')"));return {rows:[{used:'10'}]};}
    if(sql.includes(' AS running'))return {rows:[{running,recent}]};
    if(sql.startsWith('INSERT')&&insertError)throw new Error('database unavailable');
    return {rows:[],rowCount:1};
  },release(){released=true;}};
  const db={pool:{async connect(){return client;},query:client.query}} as unknown as Database;
  return {store:new AiStore(db,limit),calls,get released(){return released;}};
}

test('all public roles share the Shanghai calendar-day limit and existing requests remain readable',async()=>{
  const full=fixture({limit:'10'});
  await assert.rejects(full.store.reserve('other','new','asset','hash'),e=>e instanceof HttpException && e.getStatus()===429);
  assert(!full.calls.some(c=>c.sql.startsWith('INSERT')));
  assert.equal(await fixture({exists:true,limit:'10'}).store.reserve('actor','original','asset','hash'),false);
});

test('AI reservation commits under a database lock and scopes identity and request',async()=>{
  const f=fixture();assert.equal(await f.store.reserve('actor','req','asset','hash'),true);
  assert.equal(f.calls[0].sql,'BEGIN');assert.equal(f.calls.at(-1)?.sql,'COMMIT');
  assert(f.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
  assert.deepEqual(f.calls.find(c=>c.sql.startsWith('INSERT'))?.args,['actor','req','asset','hash']);assert(f.released);
});

test('existing requests bypass cost reservation without new insert',async()=>{
  const f=fixture({exists:true,running:2,recent:5});assert.equal(await f.store.reserve('actor','req','asset','hash'),false);
  assert(!f.calls.some(c=>c.sql.startsWith('INSERT')));assert.equal(f.calls.at(-1)?.sql,'COMMIT');assert(f.released);
});

test('concurrency and per-actor budgets reject with rollback and released connection',async()=>{
  for(const limits of [{running:2,recent:0},{running:0,recent:5}]){
    const f=fixture(limits);
    await assert.rejects(f.store.reserve('actor','req','asset','hash'),e=>e instanceof HttpException&&e.getStatus()===429);
    assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');assert(f.released);assert(!f.calls.some(c=>c.sql.startsWith('INSERT')));
  }
  const broken=fixture({insertError:true});await assert.rejects(broken.store.reserve('actor','req','asset','hash'));
  assert.equal(broken.calls.at(-1)?.sql,'ROLLBACK');assert(broken.released);
});
