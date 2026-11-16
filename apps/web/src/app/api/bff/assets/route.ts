import { NextRequest } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay } from '@/lib/server/session';

export async function GET(req: NextRequest) {
  const { name } = await getSessionActor();
  const qs = req.nextUrl.searchParams.toString();
  const res = await callBackendApi(name, 'GET', `/overview/assets${qs ? `?${qs}` : ''}`);
  return jsonRelay(res);
}
