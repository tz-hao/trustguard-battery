import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getRuntimeDir } from '@/lib/server/api-client';
import { verifyCsrf } from '@/lib/server/session';

interface OperationEventInput {
  actor_msp: string;
  target_msp: string | null;
  action: string;
  at: string;
  rejected?: boolean;
  report_reversal?: boolean;
  approval_latency_seconds?: number | null;
}

function buildScenarioEvents(scenario: 'normal' | 'collusion'): OperationEventInput[] {
  const nowIso = new Date().toISOString();
  if (scenario === 'normal') {
    return [
      { actor_msp: 'PackOrgMSP', target_msp: null, action: 'RequestRelease', at: nowIso, approval_latency_seconds: null },
      { actor_msp: 'CellOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 18 },
      { actor_msp: 'LabOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 24 },
      { actor_msp: 'PackOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 15 },
    ];
  }
  return [
    { actor_msp: 'CellOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 1 },
    { actor_msp: 'PackOrgMSP', target_msp: 'CellOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 2 },
    { actor_msp: 'CellOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 1 },
    { actor_msp: 'PackOrgMSP', target_msp: 'CellOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 2 },
    { actor_msp: 'CellOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 1 },
    { actor_msp: 'PackOrgMSP', target_msp: 'CellOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 2 },
    { actor_msp: 'LabOrgMSP', target_msp: 'PackOrgMSP', action: 'ApproveRelease', at: nowIso, approval_latency_seconds: 22 },
  ];
}

function callRiskOperations(payload: { as_of: string; operations: OperationEventInput[] }) {
  const rt = getRuntimeDir();
  const agent = new https.Agent({
    cert: readFileSync(/*turbopackIgnore: true*/ path.join(rt, 'services/gateway-workload.crt')),
    key: readFileSync(/*turbopackIgnore: true*/ path.join(rt, 'services/gateway-workload.key')),
    ca: readFileSync(/*turbopackIgnore: true*/ path.join(rt, 'server-ca/ca.crt')),
    rejectUnauthorized: true,
  });
  const baseUrl = process.env.TRUSTGUARD_RISK_URL ?? 'https://localhost:18000';
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    const req = https.request(
      `${baseUrl}/operations/analyze`,
      {
        method: 'POST',
        agent,
        timeout: 15000,
        headers: { 'content-type': 'application/json', 'content-length': bytes.byteLength },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          agent.destroy();
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode ?? 500, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 500, data: { raw } });
          }
        });
      },
    );
    req.on('error', err => {
      agent.destroy();
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy(new Error('RISK_TIMEOUT'));
    });
    req.end(bytes);
  });
}

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;

  const body = (await request.json().catch(() => ({}))) as { scenario?: 'normal' | 'collusion' };
  const scenario = body.scenario === 'collusion' ? 'collusion' : 'normal';
  const operations = buildScenarioEvents(scenario);
  const asOf = new Date().toISOString();

  try {
    const result = await callRiskOperations({ as_of: asOf, operations });
    return NextResponse.json(
      {
        scenario,
        asOf,
        operations,
        analysis: result.data,
      },
      { status: result.status },
    );
  } catch (err) {
    return NextResponse.json(
      { code: 'RISK_UNAVAILABLE', message: err instanceof Error ? err.message : 'NetworkX 风控连接失败' },
      { status: 503 },
    );
  }
}
