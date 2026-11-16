import { NextRequest, NextResponse } from 'next/server';
import { callBackendApi } from '@/lib/server/api-client';
import { getSessionActor } from '@/lib/server/session';
import type { BatteryAssetView } from '@/lib/types';

export async function GET(req: NextRequest) {
  const { name } = await getSessionActor();
  const batchId = req.nextUrl.searchParams.get('batchId')?.trim();
  const assetId = req.nextUrl.searchParams.get('assetId')?.trim();

  if (batchId) {
    const traceRes = await callBackendApi<{
      batchId: string;
      current: { packIds: string[]; paths: { cellId: string; moduleId: string; packId: string; edgeIds: string[]; historical: boolean }[] };
      historical: { packIds: string[]; paths: { cellId: string; moduleId: string; packId: string; edgeIds: string[]; historical: boolean }[] };
      packs: BatteryAssetView[];
      source: string;
      indexedBlock: string | null;
      ledgerHeight: string;
      stale: boolean;
      updatedAt: string | null;
    }>(name, 'GET', `/trace/batch/${encodeURIComponent(batchId)}`);

    if (traceRes.status !== 200) return NextResponse.json(traceRes.data, { status: traceRes.status });

    const batchesRes = await callBackendApi<{ batches: { id: string; makerMSP: string; materialLotIds: string[]; cells: BatteryAssetView[] }[] }>(
      name,
      'GET',
      '/overview/batches',
    );
    const batchMeta = batchesRes.status === 200 ? batchesRes.data.batches.find(b => b.id === batchId) ?? null : null;

    // Collect module assets referenced in paths
    const moduleIds = [...new Set(traceRes.data.historical.paths.map(p => p.moduleId))];
    const modules = await Promise.all(
      moduleIds.map(async mId => {
        const r = await callBackendApi<BatteryAssetView>(name, 'GET', `/assets/${encodeURIComponent(mId)}`);
        return r.status === 200 ? r.data : null;
      }),
    );

    return NextResponse.json({
      mode: 'batch',
      trace: traceRes.data,
      batchMeta,
      modules: modules.filter(Boolean),
    });
  }

  if (assetId) {
    const assetRes = await callBackendApi<BatteryAssetView>(name, 'GET', `/assets/${encodeURIComponent(assetId)}`);
    if (assetRes.status !== 200) return NextResponse.json(assetRes.data, { status: assetRes.status });

    const [snapshotRes, edgesRes, inspectionsRes] = await Promise.all([
      assetRes.data.type === 'PACK'
        ? callBackendApi<{ hash: string; assets: BatteryAssetView[] }>(name, 'GET', `/assets/${encodeURIComponent(assetId)}/snapshot`)
        : Promise.resolve(null),
      callBackendApi(name, 'GET', `/assets/${encodeURIComponent(assetId)}/assembly-history`),
      callBackendApi(name, 'GET', `/assets/${encodeURIComponent(assetId)}/inspections`),
    ]);

    return NextResponse.json({
      mode: 'asset',
      asset: assetRes.data,
      snapshot: snapshotRes && snapshotRes.status === 200 ? snapshotRes.data : null,
      edges: edgesRes.status === 200 ? edgesRes.data : [],
      inspections: inspectionsRes.status === 200 ? inspectionsRes.data : [],
    });
  }

  return NextResponse.json({ code: 'INVALID_INPUT' }, { status: 400 });
}
