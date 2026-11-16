import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const { id } = await context.params;
  const { name } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as { granteeMSP?: string; requestId?: string };
  const res = await callBackendApi(name, 'POST', `/reports/${encodeURIComponent(id)}/revocations`, {
    requestId: body.requestId ?? `rev-${randomUUID().slice(0, 8)}`,
    granteeMSP: body.granteeMSP,
  });
  return jsonRelay(res);
}
