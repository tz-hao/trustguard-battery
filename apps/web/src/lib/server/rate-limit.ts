import { NextRequest, NextResponse } from 'next/server';

type Bucket = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 4096;
const buckets = new Map<string, Bucket>();

function clientKey(request: NextRequest, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const ip = forwarded || realIp || 'local';
  return `${scope}:${ip}`;
}

function pruneExpired(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }
}

export function checkIpRateLimit(
  request: NextRequest,
  scope: string,
  defaultLimit: number,
  envVar = 'TRUSTGUARD_BFF_RATE_LIMIT',
): NextResponse | null {
  const rawOverride = process.env[envVar];
  const parsedOverride = rawOverride ? Number(rawOverride) : Number.NaN;
  const limit = Number.isFinite(parsedOverride) && parsedOverride > 0 ? Math.floor(parsedOverride) : defaultLimit;

  const now = Date.now();
  pruneExpired(now);
  const key = clientKey(request, scope);
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }

  current.count += 1;
  if (current.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      {
        code: 'RATE_LIMITED',
        message: '查询过于频繁，已触发防遍历限流保护，请稍后重试',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
        },
      },
    );
  }
  return null;
}
