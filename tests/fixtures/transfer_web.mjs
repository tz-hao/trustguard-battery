import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BatteryController } from '../../services/api/dist/controller.js';
import { OverviewService } from '../../services/api/dist/overview.js';
import { canonicalJson } from '../../services/api/dist/config.js';
import { PolicyService } from '../../services/api/dist/policy.js';
import { createPublicKey } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Normal Next routes, mTLS identity, Nest controller and Go rules. Only the
// transaction transport, peer receipts and SQL index are replaced for this fixture.
export async function startTransferWeb({withPolicy=false} = {}) {
  const deployment = withPolicy ? JSON.parse(await readFile(path.join(root,'infrastructure/runtime/business/deployment-1.4.json'),'utf8')) : null;
  const work = await mkdtemp(path.join(os.tmpdir(), 'trustguard-transfer-'));
  const certificates = path.join(work, 'identities');
  const localFile = name => readFile(path.join(certificates, name));
  execFileSync(path.join(root,'.venv/bin/python'), ['-c', [
    'from pathlib import Path',
    'import sys',
    'sys.path.insert(0,"infrastructure/scripts")',
    'from business_certificates import prepare',
    'prepare(Path(sys.argv[1]), {"cell":1,"pack":2,"lab":3,"recycle":4})',
  ].join('\n'), certificates], {cwd:root});
  const bin = path.join(work, 'transfer-engine');
  execFileSync(path.join(root, '.tools/go1.26.4/bin/go'), ['build', '-o', bin, '../tests/fixtures/transfer_engine.go'], {
    cwd: path.join(root, 'chaincode'), env:{...process.env, GOPROXY:'off', GOTOOLCHAIN:'local',
      GOCACHE:path.join(root,'.tools/go-build'), GOPATH:path.join(root,'.tools/gopath')},
  });
  const identities = JSON.parse(await localFile('identities.json'));
  const engine = spawn(bin, [], {stdio:['pipe','pipe','inherit']});
  const calls = [];
  const lines = createInterface({input:engine.stdout});
  lines.on('line', line => {
    const {resolve,reject} = calls.shift();
    const reply = JSON.parse(line);
    if (reply.error) reject(new Error(reply.error));
    else resolve(reply.value);
  });
  engine.on('exit', () => {
    for (const call of calls.splice(0)) call.reject(new Error('fixture engine stopped'));
  });
  const ledger = (op, data = {}) => new Promise((resolve,reject) => {
    calls.push({resolve,reject});
    engine.stdin.write(JSON.stringify({op,...data})+'\n');
  });
  const actorFor = i => ({MSP:i.mspId, ID:i.name, Role:i.role});
  const fabric = { query: (identity, kind, id) => ledger('query',{actor:actorFor(identity), query:{kind,id}}) };
  const receipts = new Map();
  const receiptKey = (actor,id) => actor.identity.name + ':' + id;
  const transactions = {
    async replay(actor, command) {
      const record = receipts.get(receiptKey(actor,command.requestId));
      if (record && record.intent !== canonicalJson(command)) throw new Error('IDEMPOTENCY_CONFLICT');
      return record?.response ?? null;
    },
    async status(actor, id) { return receipts.get(receiptKey(actor,id))?.response; },
    async execute(actor, command) {
      let response;
      try {
        const result = await ledger('execute',{actor:actorFor(actor.identity),command});
        const receipt = await fabric.query(actor.identity,'request',command.requestId);
        if (result.txId !== receipt.result.txId) throw new Error('FIXTURE_RECEIPT_MISMATCH');
        response = {completed:true, stage:'isolated-memory', requestId:command.requestId, txId:result.txId, result};
      } catch (error) {
        response = {completed:false, stage:'rejected', requestId:command.requestId, errorCode:error.message.split(':')[0]};
      }
      receipts.set(receiptKey(actor,command.requestId),{intent:canonicalJson(command),response});
      return response;
    },
  };
  const db = {pool:{async query(sql) {
    const rows = await ledger(sql.includes('asset_index') ? 'packs' : 'transfers');
    return {rows:rows.map(body => ({body, block_number:'fixture', tx_id:body.cancelledTx || body.committedTx || body.acceptedTx || body.sentTx || body.createdTx}))};
  }}};
  const overview = new OverviewService(db, fabric, undefined, identities, 'fixture');
  const originalAuditKey = process.env.TRUSTGUARD_AUDIT_KEY_FILE;
  let policyService, currentPolicy;
  const previews = [];
  if (withPolicy) {
    const publicKey = createPublicKey(await localFile('services/risk-signing.pub')).export({format:'jwk'});
    currentPolicy = {version:1,requiredOrgs:['CellOrgMSP','LabOrgMSP','PackOrgMSP'],highRiskOrgs:['CellOrgMSP','PackOrgMSP','LabOrgMSP','RecycleOrgMSP'],
      riskKeys:{'risk-v1':Buffer.from(publicKey.x,'base64url').toString('base64')},maxRiskSeconds:300,releaseSeconds:600,simulationOnly:true};
    const previewStore = {pool:{async query(sql,params) {
      if (sql.startsWith('INSERT INTO policy_previews')) {
        const [id,,policy_hash,base_version,tests_hash,passed,report,signature]=params;
        previews.push({id,policy_hash,base_version,tests_hash,passed,report:JSON.parse(report),signature});
        return {rows:[]};
      }
      return {rows:previews.filter(p=>p.id===params[0] && (params.length===1 || p.tests_hash===params[1]))};
    }}};
    process.env.TRUSTGUARD_AUDIT_KEY_FILE=path.join(certificates,'services/audit-signing.key');
    policyService=new PolicyService(previewStore,{query:async()=>currentPolicy,
      definition:async()=>({version:deployment.version,sequence:String(deployment.sequence)})});
  }
  const controller = new BatteryController(fabric,transactions,undefined,undefined,undefined,undefined,policyService);
  const api = createServer({cert:await localFile('services/api.crt'), key:await localFile('services/api.key'),
    ca:await localFile('api-client-ca/ca.crt'), requestCert:true, rejectUnauthorized:true}, async (req,res) => {
    const send = (status,body) => {res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    try {
      const identity = identities.find(i => i.clientFingerprint === req.socket.getPeerCertificate().fingerprint256);
      if (!identity) return send(403,{code:'UNKNOWN_CLIENT_CERTIFICATE'});
      if (req.url === '/api/v1/overview/transfers' && req.method === 'GET') return send(200,await overview.transfers());
      if (req.url === '/api/v1/overview/dashboard' && req.method === 'GET') return send(200,{summary:{chaincode:{name:'memory-fixture',version:'test'}}});
      if (withPolicy && req.url === '/api/v1/overview/releases' && req.method === 'GET') {
        return send(200,{currentPolicy,candidates:[],previews:previews.map(p=>({id:p.id,passed:p.passed,
          policyHash:p.policy_hash,testsHash:p.tests_hash,baseVersion:p.base_version,report:p.report,createdAt:new Date().toISOString()}))});
      }
      if (withPolicy && req.url === '/api/v1/policies/previews' && req.method === 'POST') {
        const chunks=[];
        for await (const part of req) chunks.push(part);
        return send(201,await controller.previewPolicy({actor:{identity,actorHash:identity.clientFingerprint}},JSON.parse(Buffer.concat(chunks).toString())));
      }
      if (req.url.startsWith('/api/v1/commands/') && req.method === 'POST') {
        const chunks = [];
        for await (const part of req) chunks.push(part);
        return send(201,await controller.command({actor:{identity,actorHash:identity.clientFingerprint}},
          req.url.split('/').pop(),JSON.parse(Buffer.concat(chunks).toString())));
      }
      return send(404,{code:'TEST_ROUTE_UNAVAILABLE'});
    } catch {return send(500,{code:'TEST_GATEWAY_ERROR'});}
  });
  let web;
  async function close() {
    if (web && web.exitCode === null && !web.killed) {
      const stopped = once(web,'exit');
      web.kill(); await stopped;
    }
    api.closeAllConnections();
    if (api.listening) await new Promise(resolve => api.close(resolve));
    engine.stdin.end();
    if (withPolicy) {
      if (originalAuditKey === undefined) delete process.env.TRUSTGUARD_AUDIT_KEY_FILE;
      else process.env.TRUSTGUARD_AUDIT_KEY_FILE=originalAuditKey;
    }
  }
  try {
    api.listen(0,'127.0.0.1'); await once(api,'listening');
    const probe=net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening');
    const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
    const url='http://127.0.0.1:'+port;
    web=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],
      {cwd:path.join(root,'apps/web'), env:{...process.env, TRUSTGUARD_IDENTITIES_FILE:path.join(certificates,'identities.json'),
        TRUSTGUARD_API_BASE_URL:'https://127.0.0.1:'+api.address().port+'/api/v1'},stdio:['ignore','ignore','inherit']});
    for (let attempt=0;attempt<90;attempt++) {
      if (web.exitCode !== null) throw new Error('isolated Next server exited');
      try {if ((await fetch(url+'/transfers')).ok) return {url,close,policyService,previews,currentPolicy};} catch { /* starting */ }
      await delay(150);
    }
    throw new Error('isolated Next server did not become ready');
  } catch (error) {
    await close();
    throw error;
  }
}
