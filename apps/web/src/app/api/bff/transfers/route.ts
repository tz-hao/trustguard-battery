import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay } from '@/lib/server/session';

export async function GET() {
  const { name } = await getSessionActor();
  const res = await callBackendApi(name, 'GET', '/overview/transfers');
  return jsonRelay(res);
}
