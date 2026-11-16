import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ApiClient} from './api-client.mjs';
import {loadConfiguration} from '../dist/config.js';
import {Database} from '../dist/database.js';
const api=new ApiClient(),db=new Database(loadConfiguration().databaseUrl),id='replay-'+randomUUID().slice(0,8);
try{
  await api.ready();
  const current=await api.call('cell-admin','GET','/policies/current');
  const previews=await db.pool.query('SELECT id,report,signature,tests_hash FROM policy_previews WHERE passed=true ORDER BY created_at DESC LIMIT 1');const previous=previews.rows[0];assert(previous);
  const repeated=await api.call('cell-admin','POST','/policies/previews',{id:previous.id,policy:current.body});
  assert.equal(repeated.status,201);assert.deepEqual(repeated.body,{report:previous.report,signature:previous.signature,testsHash:previous.tests_hash});
  const reports=await db.pool.query('SELECT report_id FROM report_grants WHERE grantee_msp=$1 AND revoked_at IS NOT NULL ORDER BY report_id LIMIT 1',['CellOrgMSP']);assert(reports.rows[0]);const reportId=reports.rows[0].report_id;
  const query='SELECT revoked_at FROM report_grants WHERE report_id=$1 AND grantee_msp=$2';
  const before=await db.pool.query(query,[reportId,'CellOrgMSP']);
  const body={requestId:id,granteeMSP:'CellOrgMSP'};
  const first=await api.call('lab-inspector','POST',`/reports/${reportId}/revocations`,body),second=await api.call('lab-inspector','POST',`/reports/${reportId}/revocations`,body);
  assert.equal(first.status,201);assert.deepEqual(first.body,second.body);
  const after=await db.pool.query(query,[reportId,'CellOrgMSP']);assert.deepEqual(after.rows,before.rows);
  const conflict=await api.call('lab-inspector','POST',`/reports/${reportId}/revocations`,{...body,granteeMSP:'PackOrgMSP'});assert.equal(conflict.status,409);
  const report={network:'local',result:'PASS',activatedPreviewReplayPreserved:true,revocationReplayPreserved:true,originalRevocationTimeUnchanged:true,conflictingPayloadRejected:true,completedAt:new Date().toISOString()};
  await writeFile(path.resolve(import.meta.dirname,'../../../docs/reports/idempotency-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Activated preview and file-revocation idempotency PASS');
}finally{api.close();await db.close();}
