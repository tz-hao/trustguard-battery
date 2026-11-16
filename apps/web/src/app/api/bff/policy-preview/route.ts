import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const { name } = await getSessionActor();
  const body = await request.json().catch(() => ({}));
  const res = await callBackendApi(name, 'POST', '/policies/previews', body);
  return jsonRelay(res);
}
