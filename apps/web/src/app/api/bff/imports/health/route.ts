import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { NextResponse } from 'next/server';
import { callBackendApi, getDemoSourceSigningKeyPem } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;

  const { name } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as {
    requestId?: string;
    id?: string;
    assetId?: string;
    measuredAt?: string;
    sohBasisPoints?: number;
    cycleCount?: number;
  };

  if (!body.assetId?.trim() || typeof body.sohBasisPoints !== 'number' || typeof body.cycleCount !== 'number') {
    return NextResponse.json({ code: 'INVALID_INPUT', message: '请填写资产 ID、SOH 与循环次数' }, { status: 400 });
  }

  const snapId = body.id?.trim() || `ui-health-${randomUUID().slice(0, 8)}`;
  const measuredAt = (body.measuredAt?.trim() || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z');
  const unsigned = {
    sourceId: 'lab-source',
    id: snapId,
    assetId: body.assetId.trim(),
    measuredAt,
    sohBasisPoints: Math.round(body.sohBasisPoints),
    cycleCount: Math.round(body.cycleCount),
    simulation: true,
  };
  const key = createPrivateKey(getDemoSourceSigningKeyPem());
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned), 'utf8'), key).toString('base64');

  const res = await callBackendApi(name, 'POST', '/imports/health', {
    requestId: body.requestId ?? `ui-hp-${randomUUID().slice(0, 8)}`,
    ...unsigned,
    signature,
  });
  return jsonRelay(res);
}
