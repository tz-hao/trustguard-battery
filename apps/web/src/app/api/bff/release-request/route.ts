import { randomUUID } from 'node:crypto';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const { name } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as { requestId?: string; id?: string; packId?: string };
  const payload = {
    requestId: body.requestId ?? `relreq-${randomUUID().slice(0, 8)}`,
    id: body.id ?? `rel-${randomUUID().slice(0, 8)}`,
    packId: body.packId ?? '',
  };
  const res = await callBackendApi(name, 'POST', '/release/requests', payload);
  return jsonRelay(res);
}
