import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getPublicIdentity, listPublicIdentities, resolveActorName } from '@/lib/server/api-client';
import { ACTOR_COOKIE, LOGIN_GATE_COOKIE, getSessionActor, verifyCsrf } from '@/lib/server/session';

export async function GET() {
  const cookieStore = await cookies();
  const rawActor = cookieStore.get(ACTOR_COOKIE)?.value;
  const rawGate = cookieStore.get(LOGIN_GATE_COOKIE)?.value;
  const all = listPublicIdentities();
  // Require both a valid actor identity and the session-scoped login gate cookie
  // so stale persisted cookies or direct URL visits never bypass the login screen.
  const authenticated = Boolean(rawActor && rawGate === '1' && all.some(i => i.name === rawActor));
  const { identity } = await getSessionActor();
  return NextResponse.json({ actor: identity, identities: all, authenticated });
}

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const body = (await request.json().catch(() => ({}))) as { actorName?: string; logout?: boolean };
  if (body.logout) {
    const response = NextResponse.json({
      actor: getPublicIdentity(resolveActorName(null)),
      authenticated: false,
    });
    response.cookies.delete(ACTOR_COOKIE);
    response.cookies.delete(LOGIN_GATE_COOKIE);
    return response;
  }
  const all = listPublicIdentities();
  if (!body.actorName || !all.some(i => i.name === body.actorName)) {
    return NextResponse.json({ code: 'INVALID_IDENTITY' }, { status: 400 });
  }
  const resolved = resolveActorName(body.actorName);
  const response = NextResponse.json({ actor: getPublicIdentity(resolved), authenticated: true });
  // Session-only cookies (no maxAge) so a new browser session starts cleanly on the Login screen
  response.cookies.set(ACTOR_COOKIE, resolved, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  response.cookies.set(LOGIN_GATE_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return response;
}
