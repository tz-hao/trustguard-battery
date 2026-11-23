import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

const validId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const error = (code: string, status: number) => NextResponse.json({ code }, { status });

export async function GET(req: NextRequest) {
  const asset = req.nextUrl.searchParams.get('assetId');
  const id = req.nextUrl.searchParams.get('requestId');
  if ((asset !== null && !validId.test(asset)) || (id !== null && !validId.test(id)) || (asset && id))
    return error('INVALID_INPUT', 400);
  const path = id ? '/ai/analyses/' + id : asset ? '/ai/assets/' + asset + '/latest' : '/ai/status';
  try {
    const { name } = await getSessionActor();
    const response = jsonRelay(await callBackendApi(name, 'GET', path));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch { return error('AI_DEPENDENCY_UNAVAILABLE', 503); }
}

export async function POST(req: NextRequest) {
  const denied = verifyCsrf(req);
  if (denied) return denied;
  const input = await req.json().catch(() => null);
  if (!input || !validId.test(String(input.requestId ?? '')) || !validId.test(String(input.assetId ?? '')) ||
      !['risk_explanation','trace_question'].includes(input.task) ||
      (input.question !== undefined && (typeof input.question !== 'string' || input.question.length > 1000)))
    return error('INVALID_INPUT', 400);
  try {
    const { name } = await getSessionActor();
    return jsonRelay(await callBackendApi(name, 'POST', '/ai/analyses', input));
  } catch { return error('AI_TRANSPORT_UNCONFIRMED', 503); }
}

