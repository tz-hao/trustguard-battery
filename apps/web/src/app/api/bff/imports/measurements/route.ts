import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { NextResponse } from 'next/server';
import { callBackendApi, getDemoSourceSigningKeyPem, sha256Hex } from '@/lib/server/api-client';
import { getSessionActor, jsonRelay, verifyCsrf } from '@/lib/server/session';

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;

  const { name } = await getSessionActor();
  const body = (await request.json().catch(() => ({}))) as {
    requestId?: string;
    batchId?: string;
    rows?: {
      asset_id: string;
      batch_id?: string;
      chemistry: 'LFP' | 'TERNARY' | string;
      model: string;
      condition?: string;
      capacity_mah: number;
      resistance_uohm: number;
      voltage_mv: number;
      temperature_c: number;
    }[];
  };

  const batchId = body.batchId?.trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!batchId || rows.length === 0 || rows.length > 50) {
    return NextResponse.json({ code: 'INVALID_INPUT', message: '请提供有效的批次号与 1~50 条检测量测行' }, { status: 400 });
  }

  const header = 'asset_id,batch_id,chemistry,model,condition,capacity_mah,resistance_uohm,voltage_mv,temperature_c,simulation';
  const csvLines = [header];
  for (const r of rows) {
    const chem = r.chemistry === 'TERNARY' ? 'TERNARY' : 'LFP';
    csvLines.push(
      [
        r.asset_id.trim(),
        (r.batch_id ?? batchId).trim(),
        chem,
        (r.model || 'sim-3000').trim(),
        (r.condition || '25C-1C').trim(),
        Number(r.capacity_mah),
        Number(r.resistance_uohm),
        Number(r.voltage_mv),
        Number(r.temperature_c),
        'true',
      ].join(','),
    );
  }
  const content = Buffer.from(`${csvLines.join('\n')}\n`, 'utf8');
  const issuedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const payloadHash = sha256Hex(content);
  const manifest = JSON.stringify({ sourceId: 'lab-source', batchId, payloadHash, issuedAt });
  const key = createPrivateKey(getDemoSourceSigningKeyPem());
  const signature = sign(null, Buffer.from(manifest, 'utf8'), key).toString('base64');

  const res = await callBackendApi(name, 'POST', '/imports/measurements', {
    requestId: body.requestId ?? `ui-csv-${randomUUID().slice(0, 8)}`,
    sourceId: 'lab-source',
    batchId,
    issuedAt,
    signature,
    contentBase64: content.toString('base64'),
  });
  return jsonRelay(res);
}
