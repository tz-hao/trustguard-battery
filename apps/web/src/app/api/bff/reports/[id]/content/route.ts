import { NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor } from '@/lib/server/session';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { name, identity } = await getSessionActor();
  const res = await callBackendApi(name, 'GET', `/reports/${encodeURIComponent(id)}/content`);
  if (res.status !== 200) {
    return NextResponse.json({ allowed: false, status: res.status, actor: identity, error: res.data }, { status: res.status });
  }
  const text = res.rawBuffer ? res.rawBuffer.toString('utf8') : '';
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // plain text fallback
  }
  return NextResponse.json({ allowed: true, actor: identity, reportId: id, content: parsed });
}
