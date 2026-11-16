'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  GitBranch,
  History,
  Layers,
  Move,
  RotateCcw,
  ShieldAlert,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import {
  EmptyState,
  HashChip,
  LifecycleBadge,
  PageBanner,
  QualityBadge,
  SectionHeader,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { SlideDrawer } from '@/components/Visuals';
import { CHEMISTRY_LABELS, formatDateTime, type BatteryAssetView } from '@/lib/types';

interface BatchSummary {
  id: string;
  makerMSP: string;
  materialLotIds: string[];
  simulation: boolean;
  cellCount: number;
  cells: {
    id: string;
    code: string;
    chemistry: string;
    model: string;
    state: string;
    quality: string;
    parentId: string | null;
  }[];
}

interface TracePath {
  cellId: string;
  moduleId: string;
  packId: string;
  edgeIds: string[];
  historical: boolean;
}

interface TraceResponse {
  mode: 'batch' | 'asset';
  trace?: {
    batchId: string;
    current: { packIds: string[]; paths: TracePath[] };
    historical: { packIds: string[]; paths: TracePath[] };
    packs: BatteryAssetView[];
    source: string;
    indexedBlock: string | null;
    ledgerHeight: string;
    stale: boolean;
    updatedAt: string | null;
  };
  batchMeta?: BatchSummary | null;
  modules?: BatteryAssetView[];
  asset?: BatteryAssetView;
  snapshot?: { hash: string; assets: BatteryAssetView[] } | null;
  edges?: { id: string; parentId: string; childId: string; revision: number; activeFrom: string; activeTo: string | null; txId: string }[];
}

interface GraphNode {
  id: string;
  label: string;
  code?: string;
  type: 'MATERIAL' | 'BATCH' | 'CELL' | 'MODULE' | 'PACK' | 'LIFECYCLE';
  quality?: string;
  state?: string;
  chemistry?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  historical: boolean;
}

function qualityStyle(q?: string) {
  if (q === 'QC_PASSED') return { stroke: '#0F9D8A', badgeBg: '#159B76', text: '#6EE7B7' };
  if (q === 'QC_REJECTED') return { stroke: '#DC5353', badgeBg: '#DC5353', text: '#FCA5A5' };
  if (q === 'REVIEW_REQUIRED') return { stroke: '#D99A2B', badgeBg: '#D99A2B', text: '#FDE68A' };
  return { stroke: '#3185D8', badgeBg: '#64748B', text: '#CBD5E1' };
}

function TraceContent() {
  const searchParams = useSearchParams();
  const { actor, switchActor } = useIdentity();
  const qBatch = searchParams.get('batchId') ?? '';
  const qAsset = searchParams.get('assetId') ?? '';

  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [packs, setPacks] = useState<BatteryAssetView[]>([]);
  const [modulesAll, setModulesAll] = useState<BatteryAssetView[]>([]);
  const [cellsAll, setCellsAll] = useState<BatteryAssetView[]>([]);
  const [traceMode, setTraceMode] = useState<'batch' | 'forward' | 'reverse' | 'history'>('batch');
  const [selectedBatch, setSelectedBatch] = useState(qBatch);
  const [selectedAsset, setSelectedAsset] = useState(qAsset);
  const [data, setData] = useState<TraceResponse | null>(null);
  const [drawerNode, setDrawerNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);

  // Assembly Authorization & Binding Drawer State
  const [assemblyOpen, setAssemblyOpen] = useState(false);
  const [authChildId, setAuthChildId] = useState('');
  const [authParentId, setAuthParentId] = useState('');
  const [bindParentId, setBindParentId] = useState('');
  const [bindChildrenText, setBindChildrenText] = useState('');
  const [assemblyBusy, setAssemblyBusy] = useState(false);
  const [assemblyBanner, setAssemblyBanner] = useState<CommandResultState | null>(null);

  // Interactive pan, zoom & per-node drag offsets
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showHistorical, setShowHistorical] = useState(true);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});

  const canvasDrag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const nodeDrag = useRef<{ id: string; startX: number; startY: number; origDx: number; origDy: number; moved: boolean } | null>(null);

  const resetLayout = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNodeOffsets({});
  }, []);

  const runBatchTrace = useCallback(
    async (batchId: string, mode: 'batch' | 'history' = 'batch') => {
      if (!batchId) return;
      setTraceMode(mode);
      setShowHistorical(mode === 'history' ? true : showHistorical);
      setSelectedBatch(batchId);
      setSelectedAsset('');
      setDrawerNode(null);
      resetLayout();
      setLoading(true);
      try {
        const res = await fetch(`/api/bff/trace?batchId=${encodeURIComponent(batchId)}`, { cache: 'no-store' });
        if (res.ok) setData((await res.json()) as TraceResponse);
      } finally {
        setLoading(false);
      }
    },
    [resetLayout, showHistorical],
  );

  const runAssetTrace = useCallback(
    async (assetId: string, mode: 'forward' | 'reverse' = 'reverse') => {
      if (!assetId) return;
      setTraceMode(mode);
      setSelectedAsset(assetId);
      setSelectedBatch('');
      setDrawerNode(null);
      resetLayout();
      setLoading(true);
      try {
        const res = await fetch(`/api/bff/trace?assetId=${encodeURIComponent(assetId)}`, { cache: 'no-store' });
        if (res.ok) setData((await res.json()) as TraceResponse);
      } finally {
        setLoading(false);
      }
    },
    [resetLayout],
  );

  useEffect(() => {
    void (async () => {
      const [bRes, aRes] = await Promise.all([
        fetch('/api/bff/batches', { cache: 'no-store' }),
        fetch('/api/bff/assets', { cache: 'no-store' }),
      ]);
      const bJson = bRes.ok ? ((await bRes.json()) as { batches: BatchSummary[] }) : { batches: [] };
      const aJson = aRes.ok ? ((await aRes.json()) as { assets: BatteryAssetView[] }) : { assets: [] };
      setBatches(bJson.batches);
      const all = aJson.assets;
      const pk = all.filter(a => a.type === 'PACK');
      const md = all.filter(a => a.type === 'MODULE');
      const cl = all.filter(a => a.type === 'CELL');
      setPacks(pk);
      setModulesAll(md);
      setCellsAll(cl);
      if (cl.length) setAuthChildId(prev => prev || cl[0].id);
      if (md.length) {
        setAuthParentId(prev => prev || md[0].id);
        setBindParentId(prev => prev || md[0].id);
      }

      if (qBatch) {
        void runBatchTrace(qBatch, 'batch');
      } else if (qAsset) {
        void runAssetTrace(qAsset, 'reverse');
      } else if (bJson.batches.length > 0) {
        const preferred = bJson.batches.find(b => b.id.includes('live')) ?? bJson.batches[0];
        void runBatchTrace(preferred.id, 'batch');
      }
    })();
  }, [qBatch, qAsset, runBatchTrace, runAssetTrace]);

  // Build full lineage graph columns: Material/Batch -> Cell -> Module -> PACK -> Use/Scrap Stage
  const graph: {
    cols: GraphNode[][];
    edges: GraphEdge[];
  } | null = (() => {
    if (!data) return null;
    if (data.mode === 'batch' && data.trace) {
      const lots = data.batchMeta?.materialLotIds ?? [];
      const cells = data.batchMeta?.cells ?? [];
      const mods = data.modules ?? [];
      const packList = data.trace.packs ?? [];
      const paths = data.trace.historical.paths.filter(p => (showHistorical ? true : !p.historical));
      const lifecycleNodes: GraphNode[] = packList
        .filter(p => ['IN_USE', 'RETIRED', 'RECEIVED_FOR_RECYCLING', 'PROCESSED'].includes(p.state))
        .map(p => ({
          id: `stage-${p.id}`,
          label: p.scrapped ? '已报废确认' : p.state === 'IN_USE' ? '整车使用中' : '退役/回收',
          type: 'LIFECYCLE',
          state: p.state,
          quality: p.scrapped ? 'QC_REJECTED' : 'QC_PASSED',
        }));

      return {
        cols: [
          lots.length
            ? lots.map(id => ({ id, label: id, type: 'MATERIAL' as const, quality: 'QC_PASSED' }))
            : [{ id: data.trace.batchId, label: data.trace.batchId, type: 'BATCH' as const, quality: 'QC_PASSED' }],
          cells.map(c => ({
            id: c.id,
            label: c.id,
            code: c.code,
            type: 'CELL' as const,
            quality: c.quality,
            state: c.state,
            chemistry: c.chemistry,
          })),
          mods.map(m => ({
            id: m.id,
            label: m.id,
            code: m.code,
            type: 'MODULE' as const,
            quality: m.quality,
            state: m.state,
            chemistry: m.chemistry,
          })),
          packList.map(p => ({
            id: p.id,
            label: p.id,
            code: p.code,
            type: 'PACK' as const,
            quality: p.quality,
            state: p.state,
            chemistry: p.chemistry,
          })),
          lifecycleNodes,
        ],
        edges: [
          ...cells.map(c => ({ from: lots[0] ?? data.trace!.batchId, to: c.id, historical: false })),
          ...paths.map(p => ({ from: p.cellId, to: p.moduleId, historical: p.historical })),
          ...paths.map(p => ({ from: p.moduleId, to: p.packId, historical: p.historical })),
          ...lifecycleNodes.map(ln => ({ from: ln.id.replace('stage-', ''), to: ln.id, historical: false })),
        ],
      };
    }

    if (data.mode === 'asset' && data.asset) {
      const snapAssets = data.snapshot?.assets ?? [data.asset];
      const cells = snapAssets.filter(a => a.type === 'CELL');
      const mods = snapAssets.filter(a => a.type === 'MODULE');
      const packList = snapAssets.filter(a => a.type === 'PACK');
      const batchNodes = [...new Set(cells.map(c => c.batchId).filter(Boolean))] as string[];
      const lifecycleNodes: GraphNode[] = packList
        .filter(p => ['IN_USE', 'RETIRED', 'RECEIVED_FOR_RECYCLING', 'PROCESSED'].includes(p.state))
        .map(p => ({
          id: `stage-${p.id}`,
          label: p.scrapped ? '已报废确认' : p.state === 'IN_USE' ? '整车使用中' : '退役/回收',
          type: 'LIFECYCLE',
          state: p.state,
          quality: p.scrapped ? 'QC_REJECTED' : 'QC_PASSED',
        }));

      return {
        cols: [
          batchNodes.map(id => ({ id, label: id, type: 'BATCH' as const, quality: 'QC_PASSED' })),
          cells.map(c => ({
            id: c.id,
            label: c.id,
            code: c.code,
            type: 'CELL' as const,
            quality: c.quality,
            state: c.state,
            chemistry: c.chemistry,
          })),
          mods.map(m => ({
            id: m.id,
            label: m.id,
            code: m.code,
            type: 'MODULE' as const,
            quality: m.quality,
            state: m.state,
            chemistry: m.chemistry,
          })),
          packList.map(p => ({
            id: p.id,
            label: p.id,
            code: p.code,
            type: 'PACK' as const,
            quality: p.quality,
            state: p.state,
            chemistry: p.chemistry,
          })),
          lifecycleNodes,
        ],
        edges: [
          ...cells.filter(c => c.batchId).map(c => ({ from: c.batchId!, to: c.id, historical: false })),
          ...cells.filter(c => c.parentId).map(c => ({ from: c.id, to: c.parentId!, historical: false })),
          ...mods.filter(m => m.parentId).map(m => ({ from: m.id, to: m.parentId!, historical: false })),
          ...lifecycleNodes.map(ln => ({ from: ln.id.replace('stage-', ''), to: ln.id, historical: false })),
        ],
      };
    }
    return null;
  })();

  const activeCols = graph ? graph.cols.filter(c => c.length > 0) : [];
  const maxRows = activeCols.length ? Math.max(...activeCols.map(c => c.length)) : 1;
  const canvasHeight = Math.max(360, 80 + maxRows * 96);
  const svgWidth = Math.max(980, activeCols.length * 235);

  const basePos = new Map<string, { x: number; y: number }>();
  if (graph) {
    const colXs = [120, 345, 570, 795, 1005];
    graph.cols.forEach((items, cIdx) => {
      const span = canvasHeight - 70;
      const step = span / Math.max(1, items.length + 1);
      items.forEach((item, rIdx) => {
        const off = nodeOffsets[item.id] ?? { dx: 0, dy: 0 };
        basePos.set(item.id, { x: colXs[cIdx] + off.dx, y: 45 + step * (rIdx + 1) + off.dy });
      });
    });
  }

  // Highlight connected edges when a node is selected
  const connectedIds = new Set<string>();
  if (drawerNode && graph) {
    connectedIds.add(drawerNode.id);
    for (const e of graph.edges) {
      if (e.from === drawerNode.id || e.to === drawerNode.id) {
        connectedIds.add(e.from);
        connectedIds.add(e.to);
      }
    }
  }

  async function submitAssemblyAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!authChildId || !authParentId) return;
    setAssemblyBusy(true);
    setAssemblyBanner(null);
    try {
      const res = await fetch('/api/bff/commands/assembly-authorizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: { childId: authChildId, parentId: authParentId },
          autoHashes: { evidenceHash: `auth:${authChildId}:${authParentId}:${Date.now()}` },
        }),
      });
      const json = await res.json();
      setAssemblyBanner(
        json.completed
          ? { ok: true, title: `已授权供货装配：${authChildId} → ${authParentId}`, requestId: json.requestId, txId: json.txId, stage: json.stage, blockNumber: json.blockNumber }
          : { ok: false, title: `授权失败（需 CellOrgMSP manufacturer，当前 ${actor?.name ?? '—'}）`, errorCode: json.errorCode ?? json.code ?? 'REJECTED' },
      );
    } finally {
      setAssemblyBusy(false);
    }
  }

  async function submitAssemblyBind(e: React.FormEvent) {
    e.preventDefault();
    if (!bindParentId) return;
    const parent = [...modulesAll, ...packs].find(a => a.id === bindParentId);
    const children = bindChildrenText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    setAssemblyBusy(true);
    setAssemblyBanner(null);
    try {
      const res = await fetch('/api/bff/commands/assembly', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            parentId: bindParentId,
            children,
            revision: (parent?.assemblyVersion ?? 0) + 1,
          },
          autoHashes: { evidenceHash: `bind:${bindParentId}:${children.join(',')}:${Date.now()}` },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setAssemblyBanner({
          ok: true,
          title: children.length ? `装配绑定已上链 (rev ${(parent?.assemblyVersion ?? 0) + 1})` : `完整拆解已上链确认`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        const aRes = await fetch('/api/bff/assets', { cache: 'no-store' });
        if (aRes.ok) {
          const aJson = (await aRes.json()) as { assets: BatteryAssetView[] };
          setPacks(aJson.assets.filter(a => a.type === 'PACK'));
          setModulesAll(aJson.assets.filter(a => a.type === 'MODULE'));
          setCellsAll(aJson.assets.filter(a => a.type === 'CELL'));
        }
        if (selectedBatch) void runBatchTrace(selectedBatch, 'batch');
      } else {
        setAssemblyBanner({
          ok: false,
          title: `装配绑定被拒绝（需 PackOrgMSP assembler，当前 ${actor?.name ?? '—'}）`,
          errorCode: json.errorCode ?? json.code ?? 'REJECTED',
        });
      }
    } finally {
      setAssemblyBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageBanner
        code="04 · BATTERY LINEAGE & IMPACT"
        title="动力电池全链条谱系追溯中心（可缩放 · 可拖拽 · 上下游路径高亮）"
        subtitle="支持正向溯源、反向拆解、问题批次影响范围定位及历史拆装边回溯"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAssemblyOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <Wrench className="h-3.5 w-3.5" />
              装配授权与绑定管理
            </button>
            {data?.mode === 'batch' && data.trace ? (
              <div className="flex items-center gap-2 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs">
                <span className="text-slate-400">已索引区块</span>
                <strong className="mono text-white">#{data.trace.indexedBlock ?? '—'}</strong>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">账本高度</span>
                <strong className="mono text-white">#{data.trace.ledgerHeight}</strong>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    data.trace.stale ? 'bg-[#D99A2B]/25 text-amber-200' : 'bg-[#159B76]/25 text-emerald-300'
                  }`}
                >
                  {data.trace.stale ? '同步中' : '索引已同步'}
                </span>
              </div>
            ) : null}
          </div>
        }
      />

      {/* 四种追溯视角切换栏 */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
            {[
              { id: 'batch', label: '1. 批次影响范围追溯' },
              { id: 'forward', label: '2. 正向追溯（电芯→PACK）' },
              { id: 'reverse', label: '3. 反向追溯（PACK→电芯）' },
              { id: 'history', label: '4. 历史拆装换件追溯' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (tab.id === 'batch' || tab.id === 'history') {
                    const bId = selectedBatch || batches[0]?.id;
                    if (bId) void runBatchTrace(bId, tab.id as 'batch' | 'history');
                  } else if (tab.id === 'reverse') {
                    const pId = selectedAsset || packs[0]?.id;
                    if (pId) void runAssetTrace(pId, 'reverse');
                  } else {
                    const c = cellsAll.find(x => x.batchId);
                    if (c?.batchId) void runBatchTrace(c.batchId, 'batch');
                    else if (c) void runAssetTrace(c.id, 'forward');
                    setTraceMode('forward');
                  }
                }}
                className={`rounded-lg px-3 py-1.5 transition ${
                  traceMode === tab.id ? 'bg-[#10243A] text-white' : 'bg-[#EDF2F7] text-[#172B3A] hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={selectedBatch}
              onChange={e => e.target.value && void runBatchTrace(e.target.value, traceMode === 'history' ? 'history' : 'batch')}
              className="mono rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="">选择电芯批次...</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.id} ({b.cellCount} 电芯)
                </option>
              ))}
            </select>

            <select
              value={selectedAsset}
              onChange={e => e.target.value && void runAssetTrace(e.target.value, 'reverse')}
              className="mono rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="">选择电池包 PACK...</option>
              {packs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.id} ({p.state})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 交互式工业谱系图画布（呼应效果图 2） */}
      <div className="navy-control-panel p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <GitBranch className="h-4 w-4 text-[#0F9D8A]" />
              {loading
                ? '正在构建谱系图谱...'
                : data?.mode === 'batch'
                  ? `批次影响追溯：${data.trace?.batchId}`
                  : data?.asset
                    ? `资产谱系溯源：${data.asset.id}`
                    : '谱系关系画布'}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              可拖动单个节点调整布局 · 拖动画布平移 · 滚轮缩放 · 点击节点高亮上下游路径并打开取证抽屉
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowHistorical(v => !v)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                showHistorical
                  ? 'border-[#0F9D8A] bg-[#0F9D8A]/20 text-teal-200'
                  : 'border-[#1e3a5c] bg-[#10243A] text-slate-300'
              }`}
            >
              {showHistorical ? '含历史装配边' : '仅当前装配'}
            </button>
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
              className="rounded-md border border-[#1e3a5c] bg-[#10243A] p-1.5 text-slate-200 hover:bg-[#17324f]"
              title="缩小"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="mono min-w-[44px] text-center text-[11px] text-slate-200">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
              className="rounded-md border border-[#1e3a5c] bg-[#10243A] p-1.5 text-slate-200 hover:bg-[#17324f]"
              title="放大"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={resetLayout}
              className="inline-flex items-center gap-1 rounded-md border border-[#1e3a5c] bg-[#10243A] px-2.5 py-1 text-[11px] text-slate-200 hover:bg-[#17324f]"
            >
              <RotateCcw className="h-3 w-3" />
              重置画布
            </button>
          </div>
        </div>

        {!graph ? (
          <EmptyState title="暂无可展示的谱系节点" dark />
        ) : (
          <div
            onWheel={e => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.1 : -0.1;
              setZoom(z => Math.min(2.2, Math.max(0.55, Number((z + delta).toFixed(2)))));
            }}
            onPointerDown={e => {
              if ((e.target as HTMLElement).closest('[data-node="true"]')) return;
              canvasDrag.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
            }}
            onPointerMove={e => {
              if (nodeDrag.current) {
                const dx = (e.clientX - nodeDrag.current.startX) / zoom;
                const dy = (e.clientY - nodeDrag.current.startY) / zoom;
                if (Math.hypot(dx, dy) > 3) nodeDrag.current.moved = true;
                const id = nodeDrag.current.id;
                const origDx = nodeDrag.current.origDx;
                const origDy = nodeDrag.current.origDy;
                setNodeOffsets(prev => ({ ...prev, [id]: { dx: origDx + dx, dy: origDy + dy } }));
                return;
              }
              if (canvasDrag.current) {
                setPan({
                  x: canvasDrag.current.origX + (e.clientX - canvasDrag.current.startX),
                  y: canvasDrag.current.origY + (e.clientY - canvasDrag.current.startY),
                });
              }
            }}
            onPointerUp={() => {
              canvasDrag.current = null;
              nodeDrag.current = null;
            }}
            onPointerLeave={() => {
              canvasDrag.current = null;
              nodeDrag.current = null;
            }}
            className="trace-dark-grid relative h-[410px] cursor-grab overflow-hidden rounded-xl border border-[#1e3a5c] select-none active:cursor-grabbing"
          >
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-md border border-[#1e3a5c] bg-[#10243A]/90 px-2.5 py-1 text-[10px] text-slate-300">
              <Move className="h-3 w-3 text-[#0F9D8A]" />
              拖动节点卡片调整位置 · 拖动画布平移 · 滚轮缩放 · 点击节点高亮路径
            </div>

            <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${canvasHeight}`}>
              <defs>
                <marker id="arr-teal" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L7,3 z" fill="#0F9D8A" />
                </marker>
                <marker id="arr-warn" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L7,3 z" fill="#D99A2B" />
                </marker>
                <marker id="arr-hist" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L7,3 z" fill="#64748B" />
                </marker>
              </defs>

              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {[
                  { x: 120, title: '原料 / 批次', show: graph.cols[0].length > 0 },
                  { x: 345, title: '电芯单体 (Cell)', show: graph.cols[1].length > 0 },
                  { x: 570, title: '模组 (Module)', show: graph.cols[2].length > 0 },
                  { x: 795, title: '电池包 (PACK)', show: graph.cols[3].length > 0 },
                  { x: 1005, title: '在用 / 退役 / 回收', show: graph.cols[4].length > 0 },
                ]
                  .filter(h => h.show)
                  .map(h => (
                    <g key={h.title}>
                      <rect x={h.x - 66} y="8" width="132" height="22" rx="4" fill="#10243A" stroke="#1e3a5c" />
                      <text x={h.x} y="23" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#CBD5E1">
                        {h.title}
                      </text>
                    </g>
                  ))}

                {/* Edges */}
                {graph.edges.map((e, idx) => {
                  const p1 = basePos.get(e.from);
                  const p2 = basePos.get(e.to);
                  if (!p1 || !p2) return null;
                  const highlighted = drawerNode ? connectedIds.has(e.from) && connectedIds.has(e.to) : true;
                  const x1 = p1.x + 86;
                  const y1 = p1.y;
                  const x2 = p2.x - 90;
                  const y2 = p2.y;
                  return (
                    <path
                      key={`${e.from}-${e.to}-${idx}`}
                      d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={e.historical ? '#64748B' : highlighted ? '#0F9D8A' : '#3185D8'}
                      strokeOpacity={highlighted ? 0.95 : 0.25}
                      strokeWidth={e.historical ? 1.5 : highlighted ? 2.4 : 1.6}
                      strokeDasharray={e.historical ? '6 4' : undefined}
                      markerEnd={e.historical ? 'url(#arr-hist)' : 'url(#arr-teal)'}
                    />
                  );
                })}

                {/* Nodes (Draggable!) */}
                {graph.cols.flat().map(node => {
                  const pos = basePos.get(node.id);
                  if (!pos) return null;
                  const st = qualityStyle(node.quality);
                  const isSel = drawerNode?.id === node.id;
                  const dimmed = Boolean(drawerNode && !connectedIds.has(node.id));
                  const w = 172;
                  const h = 58;
                  return (
                    <g
                      key={node.id}
                      data-node="true"
                      style={{ opacity: dimmed ? 0.38 : 1 }}
                      className="cursor-pointer"
                      onPointerDown={ev => {
                        ev.stopPropagation();
                        const cur = nodeOffsets[node.id] ?? { dx: 0, dy: 0 };
                        nodeDrag.current = {
                          id: node.id,
                          startX: ev.clientX,
                          startY: ev.clientY,
                          origDx: cur.dx,
                          origDy: cur.dy,
                          moved: false,
                        };
                      }}
                      onClick={ev => {
                        ev.stopPropagation();
                        if (nodeDrag.current?.moved) return;
                        setDrawerNode(node);
                      }}
                    >
                      <rect
                        x={pos.x - w / 2}
                        y={pos.y - h / 2}
                        width={w}
                        height={h}
                        rx={8}
                        fill="#10243A"
                        stroke={isSel ? '#2563EB' : st.stroke}
                        strokeWidth={isSel ? 2.6 : 1.6}
                      />
                      <circle cx={pos.x - w / 2 + 12} cy={pos.y - 11} r="4" fill={st.badgeBg} />
                      <text x={pos.x - w / 2 + 22} y={pos.y - 8} fontSize="9.5" fontWeight="700" fill={st.text}>
                        {node.type} {node.chemistry ? `· ${node.chemistry}` : ''}
                      </text>
                      <text x={pos.x - w / 2 + 12} y={pos.y + 8} fontSize="10.5" fontWeight="700" fill="#FFFFFF">
                        {node.label.length > 20 ? `${node.label.slice(0, 18)}..` : node.label}
                      </text>
                      <text x={pos.x - w / 2 + 12} y={pos.y + 21} fontSize="9" fill="#94A3B8">
                        {node.code ? `码 ..${node.code.slice(-8)}` : node.state ?? '关联谱系节点'}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        )}
      </div>

      {/* 底部：受影响 PACK 与装配路径表（呼应效果图 2） */}
      {data?.mode === 'batch' && data.trace && (
        <div className="card-surface p-5">
          <SectionHeader
            title={`受影响 PACK 清单与完整装配路径（现行 ${data.trace.current.packIds.length} · 含历史 ${data.trace.historical.packIds.length}）`}
            subtitle="一旦某批次电芯发现内阻或容量异常，立即锁定全部受影响模组、PACK 及当前持有企业"
            action={
              <Link
                href="/risk"
                className="inline-flex items-center gap-1 rounded-lg bg-[#DC5353] px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                演练异常电芯放行阻断
              </Link>
            }
          />

          {data.trace.historical.paths.length === 0 ? (
            <EmptyState title="该批次暂未装配至下游 PACK" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#dce4ee] text-[11px] text-[#64748B]">
                  <tr>
                    <th className="py-2 pr-3">序号</th>
                    <th className="py-2 pr-3">PACK 编号</th>
                    <th className="py-2 pr-3">完整装配路径（批次 → 电芯 → 模组 → PACK）</th>
                    <th className="py-2 pr-3">关系状态</th>
                    <th className="py-2 pr-3">PACK 生命周期</th>
                    <th className="py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF2F7]">
                  {data.trace.historical.paths.map((path, idx) => {
                    const pAsset = data.trace?.packs.find(p => p.id === path.packId);
                    return (
                      <tr key={`${path.packId}-${idx}`} className="hover:bg-[#F4F7FA]">
                        <td className="mono py-2.5 pr-3 text-[#64748B]">{idx + 1}</td>
                        <td className="mono py-2.5 pr-3 font-bold text-[#172B3A]">{path.packId}</td>
                        <td className="mono py-2.5 pr-3 text-[11px] text-[#172B3A]">
                          {data.trace?.batchId} → {path.cellId} → {path.moduleId} → {path.packId}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              path.historical ? 'bg-[#EDF2F7] text-[#64748B]' : 'bg-[#159B76]/15 text-[#159B76]'
                            }`}
                          >
                            {path.historical ? '历史拆装边' : '现行有效装配'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {pAsset ? <LifecycleBadge state={pAsset.state} /> : '—'}
                        </td>
                        <td className="py-2.5 text-right">
                          {pAsset && (
                            <Link
                              href={`/identity?code=${encodeURIComponent(pAsset.code)}`}
                              className="font-semibold text-[#2563EB] hover:underline"
                            >
                              数字身份证 →
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="subtle-surface mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[11px] text-[#64748B]">
            <span>
              已索引区块 <strong className="mono text-[#172B3A]">#{data.trace.indexedBlock ?? '—'}</strong> · 账本高度{' '}
              <strong className="mono text-[#172B3A]">#{data.trace.ledgerHeight}</strong>
            </span>
            <span>更新于 {formatDateTime(data.trace.updatedAt)}</span>
            <span className="font-semibold text-[#159B76]">
              {data.trace.stale ? '索引追赶中' : '索引与账本已同步'}
            </span>
          </div>
        </div>
      )}

      {data?.mode === 'asset' && data.edges && (
        <div className="card-surface p-5">
          <SectionHeader
            title="历史拆装、返工与换件装配边记录"
            subtitle="所有变更通过 revision 递增保留历史边，保证质量事故追责可回溯"
            icon={<History className="h-4 w-4 text-[#2563EB]" />}
          />
          {data.edges.length === 0 ? (
            <EmptyState title="暂无装配边记录" />
          ) : (
            <div className="space-y-2 text-xs">
              {data.edges.map(edge => (
                <div key={edge.id} className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="mono font-semibold text-[#172B3A]">
                    rev {edge.revision}：{edge.childId} → {edge.parentId}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        edge.activeTo ? 'bg-[#EDF2F7] text-[#64748B]' : 'bg-[#159B76]/15 text-[#159B76]'
                      }`}
                    >
                      {edge.activeTo ? '历史边 (已拆解)' : '现行绑定'}
                    </span>
                    <HashChip value={edge.txId} label="tx" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 右侧节点取证抽屉 */}
      <SlideDrawer
        open={Boolean(drawerNode)}
        onClose={() => setDrawerNode(null)}
        title={drawerNode ? `谱系节点详情 · ${drawerNode.id}` : ''}
        subtitle={drawerNode ? `层级类型：${drawerNode.type}` : undefined}
      >
        {drawerNode && (
          <div className="space-y-4 text-xs">
            <div className="subtle-surface space-y-2 p-4">
              <div className="flex justify-between">
                <span className="text-[#64748B]">节点标识</span>
                <span className="mono font-bold text-[#172B3A]">{drawerNode.id}</span>
              </div>
              {drawerNode.code && (
                <div className="flex justify-between">
                  <span className="text-[#64748B]">24 位标准编码</span>
                  <span className="mono font-bold text-[#2563EB]">{drawerNode.code}</span>
                </div>
              )}
              {drawerNode.chemistry && (
                <div className="flex justify-between">
                  <span className="text-[#64748B]">材料体系</span>
                  <span className="font-semibold">{CHEMISTRY_LABELS[drawerNode.chemistry] ?? drawerNode.chemistry}</span>
                </div>
              )}
              {drawerNode.quality && (
                <div className="flex justify-between">
                  <span className="text-[#64748B]">质量结论</span>
                  <QualityBadge quality={drawerNode.quality} />
                </div>
              )}
              {drawerNode.state && (
                <div className="flex justify-between">
                  <span className="text-[#64748B]">生命周期状态</span>
                  <LifecycleBadge state={drawerNode.state} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {drawerNode.type === 'PACK' && (
                <button
                  type="button"
                  onClick={() => void runAssetTrace(drawerNode.id, 'reverse')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#10243A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#17324f]"
                >
                  <Layers className="h-3.5 w-3.5" />
                  以此 PACK 反向追溯电芯
                </button>
              )}
              {drawerNode.code && (
                <Link
                  href={`/identity?code=${encodeURIComponent(drawerNode.code)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  打开数字身份证 <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </div>
        )}
      </SlideDrawer>

      {/* 受控装配授权与绑定/拆解抽屉 */}
      <SlideDrawer
        open={assemblyOpen}
        onClose={() => setAssemblyOpen(false)}
        title="受控电池装配授权与 BOM 绑定 / 拆解"
        subtitle={`当前身份：${actor?.name ?? '—'} (${actor?.roleLabel ?? ''}) · 支持历史边版本保留`}
      >
        <div className="space-y-5 text-xs">
          {assemblyBanner && <TxResultBanner result={assemblyBanner} onClose={() => setAssemblyBanner(null)} />}

          <div className="flex flex-wrap gap-1.5">
            <span className="text-[#64748B]">快捷切身份：</span>
            <button
              type="button"
              onClick={() => void switchActor('cell-manufacturer')}
              className="mono rounded border border-[#dce4ee] bg-[#F4F7FA] px-2 py-0.5 font-medium hover:border-[#2563EB]"
            >
              cell-manufacturer (授权电芯供应)
            </button>
            <button
              type="button"
              onClick={() => void switchActor('pack-assembler')}
              className="mono rounded border border-[#dce4ee] bg-[#F4F7FA] px-2 py-0.5 font-medium hover:border-[#2563EB]"
            >
              pack-assembler (装配绑定)
            </button>
          </div>

          <form onSubmit={submitAssemblyAuth} className="subtle-surface space-y-3 p-4">
            <div className="font-bold text-[#172B3A]">1. 电芯装配供应授权（AuthorizeAssembly · 需 cell-manufacturer）</div>
            <div>
              <label className="mb-1 block text-[#64748B]">选择电芯 (childId)</label>
              <select
                value={authChildId}
                onChange={e => setAuthChildId(e.target.value)}
                className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5"
              >
                {cellsAll.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.id} ({c.state})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[#64748B]">目标模组 (parentId)</label>
              <select
                value={authParentId}
                onChange={e => setAuthParentId(e.target.value)}
                className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5"
              >
                {modulesAll.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.id} ({m.state})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={assemblyBusy}
              className="w-full rounded-lg bg-[#2563EB] py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              提交供货装配授权
            </button>
          </form>

          <form onSubmit={submitAssemblyBind} className="subtle-surface space-y-3 p-4">
            <div className="font-bold text-[#172B3A]">2. 模组 / PACK 装配绑定或完整拆解（ReplaceAssembly · 需 pack-assembler）</div>
            <div>
              <label className="mb-1 block text-[#64748B]">父级组件 (MODULE 或 PACK)</label>
              <select
                value={bindParentId}
                onChange={e => setBindParentId(e.target.value)}
                className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5"
              >
                {[...modulesAll, ...packs].map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id} ({p.type} · rev {p.assemblyVersion} · {p.state})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[#64748B]">子组件 ID 列表（逗号分隔；留空提交即为完整拆解）</label>
              <input
                type="text"
                value={bindChildrenText}
                onChange={e => setBindChildrenText(e.target.value)}
                placeholder="例如 cell-1, cell-2（留空执行完整拆解）"
                className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5"
              />
            </div>
            <button
              type="submit"
              disabled={assemblyBusy}
              className="w-full rounded-lg bg-[#10243A] py-2 font-semibold text-white hover:bg-[#17324f] disabled:opacity-50"
            >
              执行装配绑定 / 版本化拆解
            </button>
          </form>
        </div>
      </SlideDrawer>
    </div>
  );
}

export default function TracePage() {
  return (
    <Suspense fallback={<div className="card-surface p-8 text-center text-sm text-[#64748B]">正在加载交互式谱系追溯中心...</div>}>
      <TraceContent />
    </Suspense>
  );
}
