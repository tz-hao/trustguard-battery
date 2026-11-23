// Starts one disposable, loopback-only PostgreSQL using an already installed image.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {ScanService} from '../dist/scans.js';

const cli=fileURLToPath(new URL('../../../infrastructure/scripts/docker-local.sh',import.meta.url));
const name='trustguard-scan-test-'+randomUUID();
const password=randomBytes(32).toString('hex');
const run=args=>execFileSync(cli,args,{encoding:'utf8',env:{...process.env,POSTGRES_PASSWORD:password}}).trim();
let pool;
let started=false;
try{
  run(['run','--rm','--pull=never','--detach','--name',name,'--tmpfs','/var/lib/postgresql/data','-p','127.0.0.1::5432',
    '-e','POSTGRES_PASSWORD','postgres:16-alpine']);
  started=true;
  const port=Number(run(['port',name,'5432/tcp']).split(':').at(-1));
  pool=new Pool({user:'postgres',host:'127.0.0.1',port,password,database:'postgres',connectionTimeoutMillis:2000});
  for(let attempt=0;;attempt++){
    try{await pool.query('SELECT 1');break;}catch(err){if(attempt===35) throw err; await delay(500);}
  }
  await pool.query(await readFile(new URL('../migrations/005_scan_observations.sql',import.meta.url),'utf8'));
  const code='SMACB010000001E119876543';
  const service=new ScanService({pool},{query:async(_identity,kind,id)=>{assert.equal(kind,'battery');if(id!==code) throw Error('NOT_FOUND');}});
  const actor=(mspId,role)=>({identity:{mspId,role},actorHash:mspId+role});
  const cell=actor('CellOrgMSP','manufacturer'),lab=actor('LabOrgMSP','inspector'),auditor=actor('LabOrgMSP','auditor');
  const input={code,requestId:randomUUID()};
  await assert.rejects(service.record(actor('CellOrgMSP','viewer'),input));
  await assert.rejects(service.record(cell,{...input,site:'manual'}));
  const [first,replay]=await Promise.all([service.record(cell,input),service.record(cell,input)]);
  assert.deepEqual(first,replay);assert.equal(first.previousSite,null);
  assert.equal((await service.record(cell,{code,requestId:randomUUID()})).previousSite,null);
  const warning=await service.record(lab,{code,requestId:randomUUID()});
  assert.equal(warning.previousSite,'电芯厂');assert.equal(warning.site,'检测站');
  assert.equal((await service.recent(auditor,code)).length,3);assert.equal((await service.recent(lab,code)).length,1);
  await pool.query("UPDATE scan_observations SET observed_at=observed_at-interval '11 minutes'");
  assert.equal((await service.record(cell,{code,requestId:randomUUID()})).previousSite,null);
  console.log('PASS · PostgreSQL: parallel replay, same-site repeat, cross-site alert, 10-minute expiry, role and site boundaries');
}finally{
  if(pool)await pool.end();
  if(started)run(['stop','--time','1',name]);
}
