import { randomUUID } from 'node:crypto';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const { resource } = await context.params;
  const { name } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as { requestId?: string; data?: Record<string, unknown> };
  const payload = {
    requestId: body.requestId ?? `ui-${randomUUID().slice(0, 8)}`,
    data: body.data ?? {},
  };
  const res = await callBackendApi(name, 'POST', `/commands/${encodeURIComponent(resource)}`, payload);
  return jsonRelay(res);
}
