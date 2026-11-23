import { randomUUID } from 'node:crypto';
import { callBackendApi, sha256Hex } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

const lifecycleEvents = new Set(['installations', 'first-use', 'retirements', 'recycling-receipts', 'scrap-confirmations']);

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const { resource } = await context.params;
  const { name } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as {
    requestId?: string;
    data?: Record<string, unknown>;
    autoHashes?: Record<string, string>;
  };

  const data: Record<string, unknown> = { ...(body.data ?? {}) };
  if (body.autoHashes && typeof body.autoHashes === 'object') {
    for (const [field, note] of Object.entries(body.autoHashes)) {
      if (!data[field] && typeof note === 'string' && note.trim()) {
        data[field] = sha256Hex(note.trim());
      }
    }
  }

  if (lifecycleEvents.has(resource) && typeof data.assetId === 'string' && data.evidenceHash === undefined) {
    // Use the server clock when the operator leaves the event time blank.
    data.at ??= new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (typeof data.at === 'string') {
      data.evidenceHash = sha256Hex(`${resource}:${data.assetId}:${data.at}`);
    }
  }

  const payload = {
    requestId: body.requestId ?? `ui-${randomUUID().slice(0, 8)}`,
    data,
  };
  const res = await callBackendApi(name, 'POST', `/commands/${encodeURIComponent(resource)}`, payload);
  return jsonRelay(res);
}
