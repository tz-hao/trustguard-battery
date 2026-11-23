import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { canonicalJson, requiredEnv, sha256 } from './config.js';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import type { AuthenticatedActor } from './types.js';

const execute=promisify(execFile);
const schema=z.object({id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),policy:z.record(z.string(),z.unknown())}).strict();

function resolvePython(root:string):string{
  for(const candidate of [process.env.TRUSTGUARD_PYTHON_BIN,path.join(root,'.venv/bin/python')]){
    if(candidate&&existsSync(candidate))return candidate;
  }
  return 'python3';
}

function resolveGo(root:string):string{
  for(const candidate of [process.env.TRUSTGUARD_GO_BIN,path.join(root,'.tools/go1.26.4/bin/go'),path.join(root,'.tools/go/bin/go')]){
    if(candidate&&existsSync(candidate))return candidate;
  }
  return 'go';
}

export class PolicyService {
  private running=false;
  constructor(private readonly db:Database,private readonly fabric:FabricService){}
  private async ruleProof(actor:AuthenticatedActor, prepareTests=false){
    const root=path.resolve(import.meta.dirname,'../../..'),definition=await this.fabric.definition(actor.identity);
    const checked=await execute(resolvePython(root),[path.join(root,'infrastructure/scripts/verify_rule_source.py'),'--version',definition.version,'--sequence',definition.sequence,
      prepareTests?'--prepare-tests':'--package-proof'],{timeout:30000,maxBuffer:65536});
    return JSON.parse(checked.stdout) as {verified:boolean;version:string;sequence:string;packageId:string;ruleSourceHash:string;testSourceHash:string;testFixtureHash:string;testDirectory?:string};
  }
  async preview(actor:AuthenticatedActor,body:unknown){
    if(actor.identity.role!=='admin')throw new HttpException({code:'FORBIDDEN'},403);
    const input=schema.parse(body);
    const existing=await this.db.pool.query('SELECT report,signature,policy_hash,tests_hash FROM policy_previews WHERE id=$1',[input.id]);
    const policyHash=sha256(canonicalJson(input.policy));
    if(existing.rows[0]){
      if(existing.rows[0].policy_hash!==policyHash)throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);
      return {report:existing.rows[0].report,testsHash:existing.rows[0].tests_hash,signature:existing.rows[0].signature};
    }
    const active=await this.fabric.query<Record<string,unknown>&{version:number}>(actor.identity,'policy');
    if(input.policy.version!==active.version+1)throw new HttpException({code:'VERSION_CONFLICT'},409);
    if(this.running)throw new HttpException({code:'PREVIEW_BUSY'},409);
    this.running=true;
    try{
      const {testDirectory,testFixtureHash,...ruleProof}=await this.ruleProof(actor,true);
      if(!testDirectory)throw new Error('DEPLOYED_RULE_DIRECTORY_REQUIRED');
      const root=path.resolve(import.meta.dirname,'../../..');
      const temp=await mkdtemp(path.join(tmpdir(),'trustguard-policy-'));
      const candidateFile=path.join(temp,'candidate.json');
      await writeFile(candidateFile,JSON.stringify(input.policy),{mode:0o600});
      const goBin=resolveGo(root);
      const goPathPrefix=goBin==='go'?'':path.dirname(goBin)+path.delimiter;
      const env={TRUSTGUARD_POLICY_CANDIDATE_FILE:candidateFile,GOTOOLCHAIN:process.env.GOTOOLCHAIN??'local',GOFLAGS:'-buildvcs=false',
        GOPATH:process.env.GOPATH??path.join(root,'.tools/gopath'),GOCACHE:process.env.GOCACHE??path.join(root,'.tools/go-build'),GOPROXY:'off',
        PATH:goPathPrefix+(process.env.PATH??'')};
      let stdout='',passed=true;
      try{const result=await execute(goBin,['test','./...','-count=1','-json'],{cwd:testDirectory,env,timeout:30000,maxBuffer:2*1024*1024});stdout=result.stdout;}
      catch(error){const result=error as {stdout?:string};stdout=result.stdout??'';passed=false;}
      const cases:{name:string;result:string;elapsedSeconds:number}[]=[];
      for(const line of stdout.split('\n')){
        if(!line.startsWith('{'))continue;
        const event=JSON.parse(line) as {Action:string;Test?:string;Elapsed?:number};
        if(event.Test&&['pass','fail','skip'].includes(event.Action))cases.push({name:event.Test,result:event.Action,elapsedSeconds:event.Elapsed??0});
      }
      const normalFlowPassed=cases.some(c=>c.name==='TestFullLifecycleAndImmutableScrap'&&c.result==='pass');
      passed=passed&&normalFlowPassed&&cases.length>=10&&cases.every(c=>c.result==='pass');
      const changes=Object.keys({...active,...input.policy}).filter(key=>canonicalJson(active[key])!==canonicalJson(input.policy[key])).sort();
      const report={id:input.id,policyHash,baseVersion:active.version,candidateVersion:input.policy.version,passed,ruleProof,testFixtureHash,
        tests:cases,changedFields:changes,authorizationDifference:{before:active.requiredOrgs,after:input.policy.requiredOrgs},
        releaseWindow:{before:active.releaseSeconds,after:input.policy.releaseSeconds},
        newUnauthorizedReleasePathsInPresetCases:passed?0:null,normalFlowPassed,
        scope:'isolated in-memory ledger executing the deployed Go domain rules; no Fabric transactions sent'};
      const testsHash=sha256(canonicalJson(report));
      const key=createPrivateKey(await readFile(requiredEnv('TRUSTGUARD_AUDIT_KEY_FILE')));
      const signature=sign(null,Buffer.from(testsHash,'hex'),key).toString('base64');
      await this.db.pool.query('INSERT INTO policy_previews(id,actor_hash,policy_hash,base_version,tests_hash,passed,report,signature) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
        [input.id,actor.actorHash,policyHash,active.version,testsHash,passed,JSON.stringify(report),signature]);
      return {report,testsHash,signature};
    }finally{this.running=false;}
  }
  async requirePassed(actor:AuthenticatedActor,data:Record<string,unknown>){
    if(!['admin','auditor'].includes(actor.identity.role))throw new HttpException({code:'FORBIDDEN'},403);
    const active=await this.fabric.query<{version:number}>(actor.identity,'policy');
    const {rows}=await this.db.pool.query('SELECT policy_hash,passed,base_version,report,signature FROM policy_previews WHERE id=$1 AND tests_hash=$2',[data.id,data.testsHash]);
    if(!rows[0]||!rows[0].passed||Number(rows[0].base_version)!==active.version||rows[0].policy_hash!==sha256(canonicalJson(data.policy)))throw new HttpException({code:'POLICY_PREVIEW_REQUIRED'},409);
    const {report,signature}=rows[0];
    const hash=sha256(canonicalJson(report));
    const publicKeyFile=path.join(path.dirname(requiredEnv('TRUSTGUARD_AUDIT_KEY_FILE')),'audit-signing.pub');
    if(hash!==data.testsHash || report.id!==data.id || !report.passed || report.policyHash!==rows[0].policy_hash ||
      report.baseVersion!==active.version || report.candidateVersion!==active.version+1 ||
      !verify(null,Buffer.from(hash,'hex'),createPublicKey(await readFile(publicKeyFile)),Buffer.from(signature,'base64')))
      throw new HttpException({code:'POLICY_PREVIEW_EVIDENCE_INVALID'},409);
    const {testFixtureHash,...proof}=await this.ruleProof(actor);
    if(canonicalJson(proof)!==canonicalJson(report.ruleProof) ||
      (report.testFixtureHash!==undefined && report.testFixtureHash!==testFixtureHash))
      throw new HttpException({code:'POLICY_RULE_VERSION_CHANGED'},409);
  }
}
