import { NextResponse } from 'next/server';
import { getPublicIdentity, listPublicIdentities, resolveActorName } from '@/lib/server/api-client';
import { ACTOR_COOKIE, getSessionActor, verifyCsrf } from '@/lib/server/session';

export async function GET() {
  const { identity } = await getSessionActor();
  return NextResponse.json({ actor: identity, identities: listPublicIdentities() });
}

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const body = (await request.json().catch(() => ({}))) as { actorName?: string };
  const all = listPublicIdentities();
  if (!body.actorName || !all.some(i => i.name === body.actorName)) {
    return NextResponse.json({ code: 'INVALID_IDENTITY' }, { status: 400 });
  }
  const resolved = resolveActorName(body.actorName);
  const response = NextResponse.json({ actor: getPublicIdentity(resolved) });
  response.cookies.set(ACTOR_COOKIE, resolved, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
