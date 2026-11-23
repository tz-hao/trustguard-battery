import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay } from '@/lib/server/session';

export async function GET(request: Request) {
  const { name } = await getSessionActor();
  const batch = new URL(request.url).searchParams.get('batch');
  const res = await callBackendApi(name, 'GET', '/overview/audit' + (batch ? '?batch=' + encodeURIComponent(batch) : ''));
  return jsonRelay(res);
}
