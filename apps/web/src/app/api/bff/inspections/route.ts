import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { NextResponse } from 'next/server';
import { callBackendApi, canonicalJson, getActorPrivateKeyPem, sha256Hex } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';
import type { BatteryAssetView } from '@/lib/types';

export async function GET() {
  const { name } = await getSessionActor();
  const res = await callBackendApi(name, 'GET', '/overview/inspections');
  return jsonRelay(res);
}

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const { name, identity } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as {
    assetId?: string;
    result?: 'QC_PASSED' | 'QC_REJECTED' | 'REVIEW_REQUIRED';
    note?: string;
  };
  if (!body.assetId || !body.result) {
    return NextResponse.json({ code: 'INVALID_INPUT' }, { status: 400 });
  }
  const assetRes = await callBackendApi<BatteryAssetView>(name, 'GET', `/assets/${encodeURIComponent(body.assetId)}`);
  if (assetRes.status !== 200) return jsonRelay(assetRes);

  const nextVersion = assetRes.data.inspectionVersion + 1;
  const reportId = `ui-ins-${randomUUID().slice(0, 8)}`;
  const plaintext = Buffer.from(
    JSON.stringify({
      simulation: true,
      assetId: body.assetId,
      result: body.result,
      version: nextVersion,
      note: body.note ?? 'Web 检测中心人工复核签发（模拟）',
      issuedBy: identity.name,
      issuedAt: new Date().toISOString(),
    }),
    'utf8',
  );
  const plaintextHash = sha256Hex(plaintext);
  const binding = { id: reportId, assetId: body.assetId, version: nextVersion, plaintextHash };
  const key = createPrivateKey(getActorPrivateKeyPem(name));
  const sourceSignature = sign('sha256', Buffer.from(canonicalJson(binding)), key).toString('base64');

  const uploadRes = await callBackendApi<{ sourceHash?: string; code?: string }>(name, 'POST', '/reports', {
    requestId: `up-${reportId}`,
    ...binding,
    sourceSignature,
    contentBase64: plaintext.toString('base64'),
  });
  if (uploadRes.status !== 201) {
    return NextResponse.json({ stage: 'report-upload-rejected', httpStatus: uploadRes.status, error: uploadRes.data }, { status: uploadRes.status });
  }

  const cmdRes = await callBackendApi(name, 'POST', '/commands/inspections', {
    requestId: `cmd-${reportId}`,
    data: {
      id: reportId,
      assetId: body.assetId,
      version: nextVersion,
      result: body.result,
      reportHash: plaintextHash,
      sourceHash: uploadRes.data.sourceHash,
    },
  });
  return NextResponse.json({ reportUpload: uploadRes.data, command: cmdRes.data }, { status: cmdRes.status });
}
