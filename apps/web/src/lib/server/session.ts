import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getPublicIdentity, resolveActorName, type ApiResponse } from './api-client';

export const ACTOR_COOKIE = 'tg_actor';

export async function getSessionActor() {
  const cookieStore = await cookies();
  const name = resolveActorName(cookieStore.get(ACTOR_COOKIE)?.value);
  return { name, identity: getPublicIdentity(name) };
}

export function jsonRelay<T>(res: ApiResponse<T>) {
  return NextResponse.json(res.data, { status: res.status });
}

export function verifyCsrf(request: Request): NextResponse | null {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json({ code: 'CSRF_CONTENT_TYPE_REQUIRED' }, { status: 403 });
  }

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (host && originHost !== host) {
        return NextResponse.json({ code: 'CSRF_ORIGIN_MISMATCH', originHost, expectedHost: host }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ code: 'CSRF_INVALID_ORIGIN' }, { status: 403 });
    }
  } else if (referer) {
    try {
      const refHost = new URL(referer).host;
      if (host && refHost !== host) {
        return NextResponse.json({ code: 'CSRF_ORIGIN_MISMATCH', originHost: refHost, expectedHost: host }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ code: 'CSRF_INVALID_ORIGIN' }, { status: 403 });
    }
  }

  return null;
}
