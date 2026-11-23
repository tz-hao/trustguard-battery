'use client';

import { QualityReview } from '@/components/QualityReview';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Eye,
  FileLock2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import {
  DemoTag,
  EmptyState,
  HashChip,
  OrgBadge,
  PageBanner,
  QualityBadge,
  SectionHeader,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { PaginationBar, SlideDrawer } from '@/components/Visuals';
import { BatchYieldBars, MeasurementBulletGrid } from '@/components/DataCharts';
import { formatDateTime, type BatteryAssetView } from '@/lib/types';

interface MeasurementItem {
  asset_id: string;
  batch_id: string;
  chemistry: string;
  model: string;
  condition: string;
  capacity_mah: number;
  resistance_uohm: number;
  voltage_mv: number;
  temperature_c: number;
  simulation: boolean;
  sourceHash: string;
  createdAt: string;
  analysis: {
    reviewRequired: boolean;
    qualityConclusion: null;
    triggeredRules: string[];
    anomalyScore: number | null;
    modelVersion: string;
    latencyMs: number;
  } | null;
}

interface ReportItem {
  id: string;
  assetId: string;
  ownerMSP: string;
  plaintextHash: string;
  version: number;
  sourceHash: string;
  createdAt: string;
  grants: { granteeMSP: string; expiresAt: string; revokedAt: string | null }[];
}

interface InspectionLedgerItem {
  id: string;
  assetId: string;
  version: number;
  result: string;
  reportHash: string;
  sourceHash: string;
  signerMSP: string;
  signerId: string;
  at: string;
  txId: string;
}

interface InspectionsPayload {
  riskReady: boolean;
  measurements: MeasurementItem[];
  reports: ReportItem[];
  inspections: InspectionLedgerItem[];
}

export default function InspectionsPage() {
  const { actor } = useIdentity();
  const [data, setData] = useState<InspectionsPayload | null>(null);
  const [assets, setAssets] = useState<BatteryAssetView[]>([]);
  const [selectedM, setSelectedM] = useState<MeasurementItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Drawer for AEAD decrypted report & grant details
  const [reportDrawer, setReportDrawer] = useState<{
    report: ReportItem;
    allowed: boolean;
    body: unknown;
  } | null>(null);

  const [banner, setBanner] = useState<CommandResultState | null>(null);
  const [rightTab, setRightTab] = useState<'sign' | 'csv'>('sign');
  const [targetAssetId, setTargetAssetId] = useState('');
  const [inspectResult, setInspectResult] = useState<'QC_PASSED' | 'QC_REJECTED' | 'REVIEW_REQUIRED'>('QC_PASSED');
  const [submitting, setSubmitting] = useState(false);

  // Signed CSV Measurement Import State
  const [csvCellId, setCsvCellId] = useState('');
  const [csvCap, setCsvCap] = useState('3000');
  const [csvRes, setCsvRes] = useState('1500');
  const [csvVolt, setCsvVolt] = useState('3300');
  const [csvTemp, setCsvTemp] = useState('25');
  const [csvBusy, setCsvBusy] = useState(false);

  // Filters & pagination for reports/inspections table
  const [filterResult, setFilterResult] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 6;

  const load = useCallback(async () => {
    try {
      const [insRes, astRes] = await Promise.all([
        fetch('/api/bff/inspections', { cache: 'no-store' }),
        fetch('/api/bff/assets', { cache: 'no-store' }),
      ]);
      if (insRes.ok) {
        const json = (await insRes.json()) as InspectionsPayload;
        setData(json);
        if (json.measurements.length > 0) setSelectedM(prev => prev ?? json.measurements[0]);
      }
      if (astRes.ok) {
        const aJson = (await astRes.json()) as { assets: BatteryAssetView[] };
        setAssets(aJson.assets);
        if (aJson.assets.length > 0) {
          const cell = aJson.assets.find(a => a.type === 'CELL') ?? aJson.assets[0];
          setTargetAssetId(prev => prev || cell.id);
          const cellWithBatch = aJson.assets.find(a => a.type === 'CELL' && a.batchId) ?? aJson.assets.find(a => a.type === 'CELL');
          if (cellWithBatch) setCsvCellId(prev => prev || cellWithBatch.id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openReportDrawer(report: ReportItem) {
    const res = await fetch(`/api/bff/reports/${encodeURIComponent(report.id)}/content`, { cache: 'no-store' });
    const json = await res.json();
    setReportDrawer({ report, allowed: res.ok && json.allowed, body: json });
  }

  async function revokeGrant(reportId: string, granteeMSP: string) {
    setBanner(null);
    const res = await fetch(`/api/bff/reports/${encodeURIComponent(reportId)}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ granteeMSP }),
    });
    const json = await res.json();
    if (res.ok && json.revoked) {
      setBanner({
        ok: true,
        title: `已撤回 ${granteeMSP} 对加密报告 ${reportId} 的后续解密权限（API 与独立密钥服务同步生效）`,
        requestId: json.requestId,
      });
      await load();
    } else {
      const errCode = json.code ?? `HTTP_${res.status}`;
      setBanner({
        ok: false,
        title:
          errCode === 'FORBIDDEN'
            ? `撤权权限不足（需报告签发机构 LabOrg inspector，当前 ${actor?.name ?? '—'}）`
            : `撤权请求未完成（当前 ${actor?.name ?? '—'}）`,
        errorCode: errCode,
      });
    }
  }

  async function submitInspection(e: React.FormEvent) {
    e.preventDefault();
    if (!targetAssetId) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch('/api/bff/inspections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: targetAssetId, result: inspectResult }),
      });
      const json = await res.json();
      if (res.ok && json.command?.completed) {
        setBanner({
          ok: true,
          title: `已上传 AEAD 加密报告并追加链上质检版本（${inspectResult}）`,
          requestId: json.command.requestId,
          txId: json.command.txId,
          stage: json.command.stage,
          blockNumber: json.command.blockNumber,
        });
        await load();
      } else {
        setBanner({
          ok: false,
          title: `签发质检被拦截（当前身份: ${actor?.name ?? '—'}）`,
          stage: json.stage ?? json.command?.stage ?? 'rejected',
          errorCode: json.error?.code ?? json.command?.errorCode ?? json.code ?? 'FORBIDDEN',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCsvMeasurement(e: React.FormEvent) {
    e.preventDefault();
    const cell = assets.find(a => a.id === csvCellId && a.type === 'CELL');
    if (!cell || !cell.batchId) {
      setBanner({ ok: false, title: '请选择带有有效批次号 (batchId) 的电芯资产' });
      return;
    }
    setCsvBusy(true);
    setBanner(null);
    try {
      const res = await fetch('/api/bff/imports/measurements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          batchId: cell.batchId,
          rows: [
            {
              asset_id: cell.id,
              batch_id: cell.batchId,
              chemistry: cell.chemistry === 'TERNARY' ? 'TERNARY' : 'LFP',
              model: cell.model || 'sim-3000',
              condition: '25C-1C',
              capacity_mah: Number(csvCap),
              resistance_uohm: Number(csvRes),
              voltage_mv: Number(csvVolt),
              temperature_c: Number(csvTemp),
            },
          ],
        }),
      });
      const json = await res.json();
      if (res.ok && json.imported) {
        setBanner({
          ok: true,
          title: `已签发源签名并导入 ${json.records} 条电芯 CSV 量测至 PG（IsolationForest 实时评分已更新）`,
          requestId: json.requestId,
        });
        await load();
      } else {
        const errCode = json.code ?? `HTTP_${res.status}`;
        setBanner({
          ok: false,
          title:
            errCode === 'FORBIDDEN'
              ? `CSV 导入权限不足（需 LabOrgMSP inspector 身份，当前: ${actor?.name ?? '—'}）`
              : `CSV 导入未完成（当前: ${actor?.name ?? '—'}）`,
          errorCode: errCode,
        });
      }
    } finally {
      setCsvBusy(false);
    }
  }

  const ms = data?.measurements ?? [];
  const caps = ms.map(m => m.capacity_mah);
  const ress = ms.map(m => m.resistance_uohm);
  const minCap = Math.min(...(caps.length ? caps : [2800])) - 100;
  const maxCap = Math.max(...(caps.length ? caps : [3200])) + 100;
  const minRes = Math.min(...(ress.length ? ress : [1200])) - 150;
  const maxRes = Math.max(...(ress.length ? ress : [1800])) + 150;

  // Join inspections with measurements and reports
  const measurementByAsset = new Map(ms.map(m => [m.asset_id, m]));
  const reportById = new Map((data?.reports ?? []).map(r => [r.id, r]));

  const mergedInspections = (data?.inspections ?? []).filter(ins => {
    if (filterResult && ins.result !== filterResult) return false;
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      const m = measurementByAsset.get(ins.assetId);
      const hay = `${ins.id} ${ins.assetId} ${m?.batch_id ?? ''} ${ins.signerMSP}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(mergedInspections.length / pageSize));
  const pagedInspections = mergedInspections.slice((tablePage - 1) * pageSize, tablePage * pageSize);

  const outlierCount = ms.filter(m => m.analysis?.reviewRequired).length;

  return (
    <div className="space-y-6">
      <PageBanner
        title="动力电池质量检测中心与加密报告存证"
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/risk"
              className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              前往 AI 风险中心 →
            </Link>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#17324f]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新检测数据
            </button>
          </div>
        }
      />

      <QualityReview key={actor?.name} assets={assets} />
      {/* 顶部核心统计 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">已存证链上质检版本</div>
          <div className="mono mt-1 text-2xl font-bold text-[#10243A]">{data?.inspections.length ?? 0}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">加密质检报告</div>
          <div className="mono mt-1 text-2xl font-bold text-[#2563EB]">{data?.reports.length ?? 0}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">测量样本 / 异常预警</div>
          <div className="mono mt-1 text-2xl font-bold text-[#172B3A]">
            {ms.length} <span className="text-sm text-[#D99A2B]">/ {outlierCount} 预警</span>
          </div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">智能风控状态</div>
          <div className={`mt-1 text-lg font-bold ${data?.riskReady ? 'text-[#159B76]' : 'text-[#DC5353]'}`}>
            {data?.riskReady ? '在线' : '降级'}
          </div>
        </div>
      </div>

      {banner && <TxResultBanner result={banner} onClose={() => setBanner(null)} />}

      {/* 批次良率堆叠可视化 */}
      {(() => {
        const byBatch = new Map<string, { passed: number; review: number; rejected: number; total: number }>();
        for (const a of assets) {
          if (!a.batchId) continue;
          const b = byBatch.get(a.batchId) ?? { passed: 0, review: 0, rejected: 0, total: 0 };
          b.total += 1;
          if (a.quality === 'QC_PASSED') b.passed += 1;
          else if (a.quality === 'QC_REJECTED') b.rejected += 1;
          else if (a.quality === 'REVIEW_REQUIRED') b.review += 1;
          byBatch.set(a.batchId, b);
        }
        const batchList = Array.from(byBatch.entries()).map(([id, s]) => ({ id, ...s }));
        return <BatchYieldBars batches={batchList} />;
      })()}

      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 左：容量与内阻散点图 + AI 异常诊断 */}
          <div className="card-surface p-5 lg:col-span-7">
            <SectionHeader
              title="容量与内阻散点分布及 AI 离群检测"
              subtitle="绿色为正常样本，琥珀色为 Isolation Forest 或工程规则标记需复核样本（点击散点查看详情）"
              icon={<Activity className="h-4 w-4 text-[#2563EB]" />}
              action={<DemoTag label="DEMO 仿真测量样本" />}
            />

            {ms.length === 0 ? (
              <EmptyState title="暂无已导入测量数据" />
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-xl border border-[#1c3554] bg-[#0B192C] p-3">
                  <svg viewBox="0 0 600 245" className="h-56 w-full">
                    {[40, 80, 120, 160, 200].map(y => (
                      <line key={`hy-${y}`} x1="58" y1={y} x2="570" y2={y} stroke="rgba(49,133,216,0.16)" strokeDasharray="3 3" />
                    ))}
                    {[120, 232, 344, 456, 568].map(x => (
                      <line key={`vx-${x}`} x1={x} y1="20" x2={x} y2="200" stroke="rgba(49,133,216,0.16)" strokeDasharray="3 3" />
                    ))}
                    <line x1="58" y1="200" x2="570" y2="200" stroke="#475569" strokeWidth="1.2" />
                    <line x1="58" y1="20" x2="58" y2="200" stroke="#475569" strokeWidth="1.2" />
                    <text x="315" y="228" textAnchor="middle" fontSize="11" fill="#94A3B8">
                      放电容量 Capacity (mAh) · [{Math.round(minCap)} ~ {Math.round(maxCap)}]
                    </text>
                    <text x="18" y="110" textAnchor="middle" fontSize="11" fill="#94A3B8" transform="rotate(-90 18 110)">
                      直流内阻 (uΩ)
                    </text>

                    {ms.map((m, idx) => {
                      const x = 70 + ((m.capacity_mah - minCap) / Math.max(1, maxCap - minCap)) * 485;
                      const y = 188 - ((m.resistance_uohm - minRes) / Math.max(1, maxRes - minRes)) * 155;
                      const flagged = Boolean(m.analysis?.reviewRequired);
                      const isSel = selectedM?.asset_id === m.asset_id && selectedM?.sourceHash === m.sourceHash;
                      return (
                        <g key={`${m.asset_id}-${idx}`} className="cursor-pointer" onClick={() => setSelectedM(m)}>
                          {flagged && (
                            <circle cx={x} cy={y} r={12} fill="rgba(217,154,43,0.22)" stroke="#D99A2B" strokeWidth="1.2" />
                          )}
                          <circle
                            cx={x}
                            cy={y}
                            r={isSel ? 8.5 : 6}
                            fill={flagged ? '#D99A2B' : '#159B76'}
                            stroke={isSel ? '#3185D8' : '#0B192C'}
                            strokeWidth={isSel ? 2.5 : 1.5}
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {selectedM && (
                  <div className="subtle-surface p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="mono font-bold text-[#10243A]">{selectedM.asset_id}</span>
                        <span className="ml-2 text-[#64748B]">
                          批次 {selectedM.batch_id} · {selectedM.chemistry} · {selectedM.condition}
                        </span>
                      </div>
                      <span
                        className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold ${
                          selectedM.analysis?.reviewRequired
                            ? 'bg-[#D99A2B]/15 text-[#b07612]'
                            : 'bg-[#159B76]/15 text-[#159B76]'
                        }`}
                      >
                        {selectedM.analysis?.reviewRequired ? '异常触发复核 (REVIEW_REQUIRED)' : '样本分布正常'}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      <div className="rounded-lg border border-[#dce4ee] bg-white p-2.5">
                        <div className="text-[10px] text-[#64748B]">容量 / 内阻</div>
                        <div className="mono mt-0.5 font-bold text-[#172B3A]">
                          {selectedM.capacity_mah} mAh / {selectedM.resistance_uohm} uΩ
                        </div>
                      </div>
                      <div className="rounded-lg border border-[#dce4ee] bg-white p-2.5">
                        <div className="text-[10px] text-[#64748B]">电压 / 测试温度</div>
                        <div className="mono mt-0.5 font-bold text-[#172B3A]">
                          {selectedM.voltage_mv} mV / {selectedM.temperature_c} ℃
                        </div>
                      </div>
                      <div className="rounded-lg border border-[#dce4ee] bg-white p-2.5">
                        <div className="text-[10px] text-[#64748B]">Isolation Forest 分数</div>
                        <div className="mono mt-0.5 font-bold text-[#2563EB]">
                          {selectedM.analysis?.anomalyScore !== null && selectedM.analysis?.anomalyScore !== undefined
                            ? selectedM.analysis.anomalyScore.toFixed(4)
                            : '—'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-[#dce4ee] bg-white p-2.5">
                        <div className="text-[10px] text-[#64748B]">AI 结论边界</div>
                        <div className="mono mt-0.5 font-bold text-[#0F9D8A]">null (人工终判)</div>
                      </div>
                    </div>

                    <MeasurementBulletGrid
                      voltageMv={selectedM.voltage_mv}
                      resistanceUohm={selectedM.resistance_uohm}
                      capacityMah={selectedM.capacity_mah}
                      temperatureC={selectedM.temperature_c}
                    />

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
                      <span>
                        模型版本：<strong className="mono">{selectedM.analysis?.modelVersion ?? 'quality-iforest-v1'}</strong> · 规则命中：
                        <strong className="mono ml-1 text-[#172B3A]">
                          {selectedM.analysis?.triggeredRules.length
                            ? selectedM.analysis.triggeredRules.join(', ')
                            : '未命中异常规则'}
                        </strong>
                      </span>
                      <HashChip value={selectedM.sourceHash} label="测量源摘要" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右：签发新版本质检报告 / 签名导入 CSV 量测 */}
          <div className="card-surface p-5 lg:col-span-5">
            <div className="mb-4 flex gap-1 rounded-lg bg-[#EDF2F7] p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setRightTab('sign')}
                className={`flex-1 rounded-md px-2.5 py-1.5 transition ${
                  rightTab === 'sign' ? 'bg-white text-[#10243A] shadow-2xs' : 'text-[#64748B]'
                }`}
              >
                签发版本化检测报告
              </button>
              <button
                type="button"
                onClick={() => setRightTab('csv')}
                className={`flex-1 rounded-md px-2.5 py-1.5 transition ${
                  rightTab === 'csv' ? 'bg-white text-[#10243A] shadow-2xs' : 'text-[#64748B]'
                }`}
              >
                签名 CSV 导入 &amp; AI 筛查
              </button>
            </div>

            {rightTab === 'sign' ? (
              <>
                <SectionHeader
                  title="签发版本化检测报告"
                  icon={<ShieldCheck className="h-4 w-4 text-[#0F9D8A]" />}
                />

                <form onSubmit={submitInspection} className="space-y-3.5 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold text-[#64748B]">选择电池资产</label>
                    <select
                      value={targetAssetId}
                      onChange={e => setTargetAssetId(e.target.value)}
                      className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
                    >
                      {assets.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.id} ({a.type} · 质检 v{a.inspectionVersion} · {a.quality})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold text-[#64748B]">检测结论</label>
                    <select
                      value={inspectResult}
                      onChange={e => setInspectResult(e.target.value as typeof inspectResult)}
                      className="w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
                    >
                      <option value="QC_PASSED">QC_PASSED · 质检合格</option>
                      <option value="QC_REJECTED">QC_REJECTED · 质检不合格</option>
                      <option value="REVIEW_REQUIRED">REVIEW_REQUIRED · 需独立复核</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !targetAssetId}
                    className="w-full rounded-lg bg-[#10243A] py-2.5 text-xs font-semibold text-white hover:bg-[#17324f] disabled:opacity-60"
                  >
                    {submitting ? '加密上传与链码签发中...' : '加密存储并上链签发报告'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <SectionHeader
                  title="LIMS 签名 CSV 量测数据导入"
                  icon={<Activity className="h-4 w-4 text-[#2563EB]" />}
                />
                <form onSubmit={submitCsvMeasurement} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold text-[#64748B]">选择待检测电芯（含批次）</label>
                    <select
                      value={csvCellId}
                      onChange={e => setCsvCellId(e.target.value)}
                      className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
                    >
                      {assets
                        .filter(a => a.type === 'CELL' && a.batchId)
                        .map(c => (
                          <option key={c.id} value={c.id}>
                            {c.id} ({c.batchId} · {c.chemistry})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block font-semibold text-[#64748B]">容量 (mAh)</label>
                      <input
                        type="number"
                        value={csvCap}
                        onChange={e => setCsvCap(e.target.value)}
                        className="mono w-full rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#64748B]">内阻 (uOhm)</label>
                      <input
                        type="number"
                        value={csvRes}
                        onChange={e => setCsvRes(e.target.value)}
                        className="mono w-full rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#64748B]">电压 (mV)</label>
                      <input
                        type="number"
                        value={csvVolt}
                        onChange={e => setCsvVolt(e.target.value)}
                        className="mono w-full rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#64748B]">温度 (℃)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={csvTemp}
                        onChange={e => setCsvTemp(e.target.value)}
                        className="mono w-full rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCsvCap('3000');
                        setCsvRes('1500');
                        setCsvVolt('3300');
                        setCsvTemp('25');
                      }}
                      className="flex-1 rounded-md border border-[#dce4ee] bg-[#F4F7FA] py-1.5 text-[11px] font-medium text-[#172B3A]"
                    >
                      填充正常参考值
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCsvCap('2520');
                        setCsvRes('2150');
                        setCsvVolt('3210');
                        setCsvTemp('28.5');
                      }}
                      className="flex-1 rounded-md border border-[#D99A2B]/40 bg-[#D99A2B]/12 py-1.5 text-[11px] font-semibold text-[#b07612]"
                    >
                      注入离群异常值
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={csvBusy || !csvCellId}
                    className="w-full rounded-lg bg-[#2563EB] py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {csvBusy ? '签名导入与 AI 分析中...' : '签名导入 CSV 量测（需 lab-inspector）'}
                  </button>
                </form>
              </>
            )}

            <div className="mt-5 border-t border-[#EDF2F7] pt-4">
              <div className="mb-2 text-xs font-bold text-[#172B3A]">独立加密报告存储状态</div>
              <div className="space-y-1.5 text-[11px] text-[#64748B]">
                <div className="flex items-center justify-between">
                  <span>加密算法</span>
                  <span className="mono font-semibold text-[#172B3A]">AEAD AES-256-GCM</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>密钥管理隔离</span>
                  <span className="mono font-semibold text-[#159B76]">独立 key-broker (:18001)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>撤权一致性</span>
                  <span className="font-semibold text-[#172B3A]">API + Broker 双路径实时拒绝</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 检测报告与链上质检明细表（支持筛选与分页 + 打开加密报告抽屉） */}
      {data && (
        <div className="card-surface p-5">
          <SectionHeader
            title="检测报告台账与受控解密访问"
            subtitle="支持按资产/批次检索与筛选；点击「解密读取」验证 AEAD 密文授权访问与撤权拦截"
            icon={<FileLock2 className="h-4 w-4 text-[#2563EB]" />}
            action={
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={filterSearch}
                  onChange={e => {
                    setFilterSearch(e.target.value);
                    setTablePage(1);
                  }}
                  placeholder="搜索报告 ID / 资产 / 批次..."
                  className="rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-3 py-1.5 text-xs outline-none focus:border-[#2563EB] focus:bg-white"
                />
                <select
                  value={filterResult}
                  onChange={e => {
                    setFilterResult(e.target.value);
                    setTablePage(1);
                  }}
                  className="rounded-lg border border-[#dce4ee] bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">结论：全部</option>
                  <option value="QC_PASSED">合格 (QC_PASSED)</option>
                  <option value="QC_REJECTED">不合格 (QC_REJECTED)</option>
                  <option value="REVIEW_REQUIRED">待复核 (REVIEW_REQUIRED)</option>
                </select>
              </div>
            }
          />

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#dce4ee] text-[11px] text-[#64748B]">
                <tr>
                  <th className="py-2.5 pr-3">报告 ID / 资产</th>
                  <th className="py-2.5 pr-3">检测批次</th>
                  <th className="py-2.5 pr-3">检测机构 / 签发</th>
                  <th className="py-2.5 pr-3">容量 / 内阻</th>
                  <th className="py-2.5 pr-3">结论与版本</th>
                  <th className="py-2.5 pr-3">报告摘要 / 加密</th>
                  <th className="py-2.5 text-right">受控安全操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF2F7]">
                {pagedInspections.map(ins => {
                  const m = measurementByAsset.get(ins.assetId);
                  const rep = reportById.get(ins.id);
                  const revokedOrgs = rep?.grants.filter(g => g.revokedAt).map(g => g.granteeMSP.replace('MSP', '')) ?? [];
                  return (
                    <tr key={ins.id} className="hover:bg-[#F4F7FA]">
                      <td className="py-2.5 pr-3">
                        <div className="mono font-bold text-[#172B3A]">{ins.id}</div>
                        <div className="mono text-[10px] text-[#64748B]">{ins.assetId}</div>
                      </td>
                      <td className="mono py-2.5 pr-3 text-[11px] text-[#172B3A]">{m?.batch_id ?? '—'}</td>
                      <td className="py-2.5 pr-3">
                        <OrgBadge mspId={ins.signerMSP} />
                        <div className="mono mt-0.5 text-[10px] text-[#64748B]">{formatDateTime(ins.at)}</div>
                      </td>
                      <td className="mono py-2.5 pr-3 text-[11px]">
                        {m ? `${m.capacity_mah} mAh / ${m.resistance_uohm} uΩ` : '未导入 CSV'}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <QualityBadge quality={ins.result} />
                          <span className="mono font-semibold text-[#64748B]">v{ins.version}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <HashChip value={ins.reportHash} />
                          {revokedOrgs.length > 0 && (
                            <span className="rounded bg-[#DC5353]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#DC5353]">
                              已撤权 {revokedOrgs.join(',')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        {rep ? (
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => void openReportDrawer(rep)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#dce4ee] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#172B3A] hover:bg-[#EDF2F7]"
                            >
                              <Eye className="h-3 w-3" />
                              解密读取
                            </button>
                            <button
                              type="button"
                              onClick={() => void revokeGrant(rep.id, 'CellOrgMSP')}
                              className="rounded-md border border-[#DC5353]/30 bg-[#DC5353]/8 px-2.5 py-1 text-[11px] font-semibold text-[#DC5353] hover:bg-[#DC5353]/15"
                            >
                              撤回 CellOrg
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#94A3B8]">仅链上摘要</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={tablePage}
            totalPages={totalPages}
            totalItems={mergedInspections.length}
            onPageChange={setTablePage}
          />
        </div>
      )}

      {/* 右侧加密报告解密抽屉 */}
      <SlideDrawer
        open={Boolean(reportDrawer)}
        onClose={() => setReportDrawer(null)}
        title={reportDrawer ? `加密报告安全检视 · ${reportDrawer.report.id}` : ''}
        subtitle={
          reportDrawer
            ? `AES-GCM 密文 · 版本 v${reportDrawer.report.version} · 请求身份 ${actor?.name ?? '—'}`
            : undefined
        }
      >
        {reportDrawer && (
          <div className="space-y-4 text-xs">
            <div
              className={`rounded-xl border p-4 ${
                reportDrawer.allowed
                  ? 'border-[#159B76]/35 bg-[#159B76]/10 text-[#0c5e47]'
                  : 'border-[#DC5353]/35 bg-[#DC5353]/10 text-[#8f2323]'
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {reportDrawer.allowed ? <Unlock className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                {reportDrawer.allowed
                  ? '密钥服务校验授权通过 · AEAD 解密成功'
                  : '访问被拦截（无权读取或授权已被撤回）'}
              </div>
              <p className="mt-1 text-[11px] opacity-90">
                API 网关与独立密钥服务 (:18001) 均验证当前 mTLS 证书所属组织与撤权表。
              </p>
            </div>

            <div className="subtle-surface space-y-2 p-3.5">
              <div className="flex justify-between">
                <span className="text-[#64748B]">所属资产</span>
                <span className="mono font-bold">{reportDrawer.report.assetId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">签发机构</span>
                <OrgBadge mspId={reportDrawer.report.ownerMSP} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">明文 SHA-256</span>
                <HashChip value={reportDrawer.report.plaintextHash} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">签名摘要</span>
                <HashChip value={reportDrawer.report.sourceHash} />
              </div>
            </div>

            <div>
              <div className="mb-1.5 font-bold text-[#172B3A]">解密读取响应载荷</div>
              <pre className="mono max-h-80 overflow-auto rounded-xl bg-[#0B192C] p-4 text-[11px] text-emerald-300">
                {JSON.stringify(reportDrawer.body, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end gap-2">
              <Link
                href="/approvals"
                className="inline-flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                前往联合审批中心 <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}
      </SlideDrawer>
    </div>
  );
}
