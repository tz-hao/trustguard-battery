import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor } from '@/lib/server/session';

function loadSimulationEvaluation() {
  const candidates = [
    path.resolve(process.cwd(), 'docs/reports/risk-simulation-evaluation.json'),
    path.resolve(process.cwd(), '../../docs/reports/risk-simulation-evaluation.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = readFileSync(/*turbopackIgnore: true*/ file, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return null;
}

export async function GET() {
  const { name } = await getSessionActor();
  const [insRes, relRes, batchRes, assetRes] = await Promise.all([
    callBackendApi<Record<string, unknown>>(name, 'GET', '/overview/inspections'),
    callBackendApi<Record<string, unknown>>(name, 'GET', '/overview/releases'),
    callBackendApi<Record<string, unknown>>(name, 'GET', '/overview/batches'),
    callBackendApi<Record<string, unknown>>(name, 'GET', '/overview/assets'),
  ]);

  if (insRes.status !== 200 || relRes.status !== 200) {
    return NextResponse.json({ code: 'RISK_OVERVIEW_UNAVAILABLE' }, { status: 502 });
  }

  const evaluation = loadSimulationEvaluation();
  return NextResponse.json({
    riskReady: Boolean(insRes.data.riskReady),
    measurements: insRes.data.measurements ?? [],
    riskResults: relRes.data.riskResults ?? [],
    releases: relRes.data.releases ?? [],
    currentPolicy: relRes.data.currentPolicy ?? null,
    batches: batchRes.status === 200 ? (batchRes.data.batches ?? []) : [],
    assets: assetRes.status === 200 ? (assetRes.data.assets ?? []) : [],
    evaluation,
    simulation: true,
  });
}
