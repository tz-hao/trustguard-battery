import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, verifyCsrf, jsonRelay } from '@/lib/server/session';
export async function POST(request: Request) {
  const denied = verifyCsrf(request); if (denied) return denied;
  const {name} = await getSessionActor();
  return jsonRelay(await callBackendApi(name,'POST','/scans',await request.json()));
}
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code') ?? '';
  const {name} = await getSessionActor();
  return jsonRelay(await callBackendApi(name,'GET',`/batteries/${encodeURIComponent(code)}/scans`));
}
