import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay } from '@/lib/server/session';

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  const { name } = await getSessionActor();
  const res = await callBackendApi(name, 'GET', `/transactions/${encodeURIComponent(requestId)}`);
  return jsonRelay(res);
}
