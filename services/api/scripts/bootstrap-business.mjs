import { readFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import path from 'node:path';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { loadConfiguration, sha256 } from '../dist/config.js';
import { Database } from '../dist/database.js';
import { FabricService } from '../dist/gateway.js';
import { TransactionService, safeErrorCode } from '../dist/transactions.js';

const config = loadConfiguration();
const db = new Database(config.databaseUrl);
const fabric = new FabricService(config);
let s3;
try {
  await db.migrate();
  const credentials = JSON.parse(await readFile(process.env.TRUSTGUARD_S3_CREDENTIALS_FILE, 'utf8'));
  s3 = new S3Client({ endpoint: process.env.TRUSTGUARD_S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials, maxAttempts: 1 });
  const Bucket = process.env.TRUSTGUARD_REPORT_BUCKET;
  try { await s3.send(new HeadBucketCommand({ Bucket })); }
  catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; await s3.send(new CreateBucketCommand({ Bucket })); }
  const admin = config.identities.find(i => i.name === 'cell-admin');
  const publicFile = path.join(path.dirname(process.env.TRUSTGUARD_RISK_KEY_FILE), 'risk-signing.pub');
  const riskPublicKey = createPublicKey(await readFile(publicFile)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  let policy;
  try { policy = await fabric.query(admin, 'policy'); }
  catch (error) { if (safeErrorCode(error) !== 'NOT_FOUND') throw error; }
  if (!policy) {
    const service = new TransactionService(db, fabric);
    const actor = { identity: admin, actorHash: sha256(admin.mspId + ':' + admin.clientFingerprint) };
    const result = await service.execute(actor, { requestId: 'bootstrap-policy-v1', action: 'Initialize', data: {
      version: 1, requiredOrgs: ['CellOrgMSP', 'LabOrgMSP', 'PackOrgMSP'],
      highRiskOrgs: ['CellOrgMSP', 'PackOrgMSP', 'LabOrgMSP', 'RecycleOrgMSP'],
      riskKeys: { 'risk-v1': riskPublicKey }, maxRiskSeconds: 300, releaseSeconds: 600, simulationOnly: true,
    } });
    if (!result.completed) throw new Error(`INITIALIZATION_NOT_VERIFIED:${result.stage}:${result.errorCode}`);
    console.log(`Local policy initialized and verified on four peers; tx=${result.txId}`);
  } else if (policy.riskKeys['risk-v1'] !== riskPublicKey) throw new Error('RISK_PUBLIC_KEY_MISMATCH');
  console.log('Business database, private report bucket and local ledger policy are ready');
} catch (error) {
  console.error(`Business bootstrap failed: ${safeErrorCode(error)}`);
  process.exitCode = 1;
} finally { s3?.destroy(); await fabric.close(); await db.close(); }
