import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor } from '@/lib/server/session';
import type { BatteryAssetView, ParsedCodeView } from '@/lib/types';

export async function GET(req: NextRequest) {
  const rawCode = (req.nextUrl.searchParams.get('code') ?? '').trim().toUpperCase();
  if (!rawCode) {
    return NextResponse.json({ code: 'INVALID_INPUT', message: '请输入电池编码' }, { status: 400 });
  }
  const { name, identity } = await getSessionActor();
  const encoded = encodeURIComponent(rawCode);

  const parsedRes = await callBackendApi<ParsedCodeView & { code?: string }>(name, 'GET', `/codes/${encoded}`);
  if (parsedRes.status !== 200) {
    return NextResponse.json({
      codeValid: false,
      rawCode,
      parseError: parsedRes.data,
      battery: null,
    });
  }

  const batteryRes = await callBackendApi<BatteryAssetView & { code?: string }>(name, 'GET', `/batteries/${encoded}`);
  if (batteryRes.status !== 200) {
    // Structure is valid under GB/T 34014, but battery may not be registered on-chain yet (e.g., standard example 101PE052011A117AA0000100)
    const makerCode = parsedRes.data.makerCode;
    const makerRes = await callBackendApi(name, 'GET', `/makers/${encodeURIComponent(makerCode)}`);
    return NextResponse.json({
      codeValid: true,
      rawCode,
      parsed: parsedRes.data,
      registered: false,
      maker: makerRes.status === 200 ? makerRes.data : null,
      battery: null,
      unregisteredReason: (batteryRes.data as { code?: string })?.code ?? 'NOT_FOUND',
      actor: identity,
    });
  }

  const asset = batteryRes.data;
  const [lifecycleRes, healthRes, historyRes, inspectionsRes, edgesRes, correctionsRes, snapshotRes] = await Promise.all([
    callBackendApi(name, 'GET', `/batteries/${encoded}/lifecycle`),
    callBackendApi(name, 'GET', `/batteries/${encoded}/health`),
    callBackendApi(name, 'GET', `/assets/${encodeURIComponent(asset.id)}/history`),
    callBackendApi(name, 'GET', `/assets/${encodeURIComponent(asset.id)}/inspections`),
    callBackendApi(name, 'GET', `/assets/${encodeURIComponent(asset.id)}/assembly-history`),
    callBackendApi(name, 'GET', `/assets/${encodeURIComponent(asset.id)}/corrections`),
    asset.type === 'PACK'
      ? callBackendApi(name, 'GET', `/assets/${encodeURIComponent(asset.id)}/snapshot`)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    codeValid: true,
    rawCode,
    parsed: parsedRes.data,
    registered: true,
    battery: asset,
    lifecycle: lifecycleRes.status === 200 ? lifecycleRes.data : null,
    health: healthRes.status === 200 ? { allowed: true, data: healthRes.data } : { allowed: false, status: healthRes.status, error: healthRes.data },
    history: historyRes.status === 200 ? historyRes.data : [],
    inspections: inspectionsRes.status === 200 ? inspectionsRes.data : [],
    edges: edgesRes.status === 200 ? edgesRes.data : [],
    corrections: correctionsRes.status === 200 ? correctionsRes.data : [],
    snapshot: snapshotRes && snapshotRes.status === 200 ? snapshotRes.data : null,
    actor: identity,
  });
}
