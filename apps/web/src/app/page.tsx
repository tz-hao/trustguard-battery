'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  Blocks,
  Cpu,
  Database,
  FileCheck2,
  GitBranch,
  Layers,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { EmptyState, OrgBadge } from '@/components/Badges';
import {
  BatteryPackExplodedVisual,
  ConsortiumTopologySvg,
  LifecycleDonutChart,
  TrustGuardBrandLogo,
} from '@/components/Visuals';
import { KpiStatCard } from '@/components/ui';
import {
  CHEMISTRY_LABELS,
  formatDateTime,
  type BatteryAssetView,
} from '@/lib/types';

interface DashboardPayload {
  summary: {
    totalAssets: number;
    cells: number;
    modules: number;
    packs: number;
    passedAssets: number;
    rejectedAssets: number;
    reviewRequiredAssets: number;
    notTestedAssets: number;
    pendingReleases: number;
    pendingTransfers: number;
    activePolicyVersion: number;
    ledgerHeight: string;
    indexedBlock: string | null;
    stale: boolean;
    indexedUpdatedAt: string | null;
    chaincode: { name: string; version: string; sequence: string };
    riskReady: boolean;
    auditLogsTotal: number;
    auditAnchoredTotal: number;
    auditPendingTotal: number;
    auditBatchesTotal: number;
    rejectedTxCount: number;
  };
  recentAssets: BatteryAssetView[];
  batches: {
    id: string;
    makerMSP: string;
    materialLotIds: string[];
    simulation: boolean;
    cellCount: number;
    passedCount: number;
    rejectedCount: number;
    reviewRequiredCount: number;
    notTestedCount: number;
  }[];
  pendingReleases: {
    id: string;
    packId: string;
    state: string;
    policyVersion: number;
    requiredOrgs: string[];
    approvals: { msp: string }[];
  }[];
  pendingTransfers: { id: string; packId: string; fromMSP: string; toMSP: string; state: string }[];
  recentRejections: {
    requestId: string;
    action: string;
    resourceId: string | null;
    stage: string;
    errorCode: string | null;
    updatedAt: string;
  }[];
  recentAlerts: {
    id: string;
    requestId: string | null;
    action: string;
    outcome: string;
    evidenceHash: string;
    anchoredTxId: string | null;
    createdAt: string;
  }[];
  organizations: { mspId: string; label: string; gatewayEndpoint: string; roles: { name: string; role: string }[] }[];
  simulationData: boolean;
}

interface AuditSummary {
  transactions: {
    requestId: string;
    stage: string;
    txId: string | null;
    blockNumber: string | null;
    errorCode: string | null;
    action: string;
    resourceId: string | null;
    updatedAt: string;
  }[];
}

function buildTrend(current: number, weight: number[]): number[] {
  const base = Math.max(1, current);
  return weight.map(w => Math.max(0, Math.round(base * w)));
}

export default function DashboardPage() {
  const { actor } = useIdentity();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [allAssets, setAllAssets] = useState<BatteryAssetView[]>([]);
  const [auditTxs, setAuditTxs] = useState<AuditSummary['transactions']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [dashRes, assetsRes, auditRes] = await Promise.all([
        fetch('/api/bff/dashboard', { cache: 'no-store' }),
        fetch('/api/bff/assets', { cache: 'no-store' }),
        fetch('/api/bff/audit', { cache: 'no-store' }),
      ]);
      const dashJson = await dashRes.json();
      if (!dashRes.ok) throw new Error(dashJson.code ?? `HTTP ${dashRes.status}`);
      setError(null);
      setData(dashJson as DashboardPayload);
      if (assetsRes.ok) {
        const assetsJson = (await assetsRes.json()) as { assets: BatteryAssetView[] };
        setAllAssets(assetsJson.assets);
      }
      if (auditRes.ok) {
        const auditJson = (await auditRes.json()) as AuditSummary;
        setAuditTxs(auditJson.transactions ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载驾驶舱数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!actor?.name) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load, actor?.name]);

  const assetSource = allAssets.length > 0 ? allAssets : (data?.recentAssets ?? []);
  const registeredOnlyCount = assetSource.filter(a => a.state === 'REGISTERED').length;
  const assembledCount = assetSource.filter(a => ['ASSEMBLED', 'RELEASED', 'INSTALLED'].includes(a.state)).length;
  const inUseCount = assetSource.filter(a => a.state === 'IN_USE').length;
  const retiredCount = assetSource.filter(a => ['RETIRED', 'RECEIVED_FOR_RECYCLING'].includes(a.state)).length;
  const scrappedCount = assetSource.filter(a => a.state === 'PROCESSED' && a.scrapped).length;

  const lifecycleDonutItems = [
    { key: 'unmounted', label: '未装配', count: registeredOnlyCount, color: '#94A3B8' },
    { key: 'assembled', label: '已装配/放行', count: assembledCount, color: '#38BDF8' },
    { key: 'in_use', label: '使用中', count: inUseCount, color: '#14B8A6' },
    { key: 'retired', label: '已退役/待回收', count: retiredCount, color: '#F59E0B' },
    { key: 'scrapped', label: '已报废确认', count: scrappedCount, color: '#F43F5E' },
  ];

  const lfpCount = assetSource.filter(a => a.chemistry === 'LFP').length;
  const ternaryCount = assetSource.filter(a => a.chemistry === 'TERNARY').length;
  const sodiumCount = assetSource.filter(a => a.chemistry === 'SODIUM_ION').length;
  const otherChemCount = Math.max(0, assetSource.length - lfpCount - ternaryCount - sodiumCount);

  const chemDistribution = [
    { key: 'LFP', label: CHEMISTRY_LABELS.LFP, count: lfpCount, bar: 'bg-gradient-to-r from-teal to-emerald-400' },
    { key: 'TERNARY', label: CHEMISTRY_LABELS.TERNARY, count: ternaryCount, bar: 'bg-gradient-to-r from-brand to-sky-400' },
    ...(sodiumCount > 0
      ? [{ key: 'SODIUM_ION', label: CHEMISTRY_LABELS.SODIUM_ION, count: sodiumCount, bar: 'bg-gradient-to-r from-sky-500 to-cyan-300' }]
      : []),
    ...(otherChemCount > 0
      ? [{ key: 'OTHER', label: '其他标准体系', count: otherChemCount, bar: 'bg-gradient-to-r from-slate-500 to-slate-300' }]
      : []),
  ];

  const securityEvents = [
    ...auditTxs.slice(0, 6).map(tx => ({
      id: tx.requestId,
      time: tx.updatedAt,
      kind:
        tx.stage === 'rejected' || tx.stage === 'invalid'
          ? '拦截拒绝'
          : tx.action === 'AnchorAudit'
            ? '审计锚定'
            : tx.action.includes('Release')
              ? '联合审批'
              : tx.action.includes('Inspection')
                ? '质量签发'
                : '业务上链',
      action: tx.action,
      source: tx.resourceId ?? tx.requestId,
      outcome: tx.errorCode ?? tx.stage,
      danger: tx.stage === 'rejected' || tx.stage === 'invalid',
    })),
  ];

  const anomalyTotal = (data?.summary.rejectedAssets ?? 0) + (data?.summary.reviewRequiredAssets ?? 0);

  return (
    <div className="space-y-6">
      {/* 深海军蓝工业监控中心主区 */}
      <div className="navy-control-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sky-400/15 pb-4">
          <div className="flex items-center gap-3.5">
            <TrustGuardBrandLogo size="md" className="logo-breathing-halo" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                动力电池全生命周期可信追溯与主动安全驾驶舱
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  联盟共识在线
                </span>
                {data && (
                  <span className="mono text-[11px] text-slate-400">
                    账本高度 #{data.summary.ledgerHeight} · 策略 v{data.summary.activePolicyVersion}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/identity"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-sky-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-brand/30 transition hover:brightness-110"
            >
              <QrCode className="h-3.5 w-3.5" />
              24 位码查身份证
            </Link>
            <Link
              href="/lab"
              className="inline-flex items-center gap-1.5 rounded-xl border border-danger/50 bg-danger/15 px-3.5 py-2 text-xs font-semibold text-red-200 transition hover:bg-danger/25"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              安全攻防实验室
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-sky-400/20 bg-navy-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-sky-400/40 hover:bg-navy-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新态势
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-danger/50 bg-danger/15 px-4 py-3 text-sm text-red-200">
            读取驾驶舱失败：{error}
          </div>
        )}

        {loading && !data && !error && (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="navy-subcard p-4">
                  <div className="skeleton-block-dark h-3 w-20" />
                  <div className="skeleton-block-dark mt-3 h-7 w-14" />
                  <div className="skeleton-block-dark mt-2 h-2.5 w-24" />
                </div>
              ))}
            </div>
            <div className="skeleton-block-dark h-56 w-full" />
          </div>
        )}

        {data && (
          <>
            {/* 顶部 6 大核心指标（含动态计数、迷你趋势线、异常呼吸灯） */}
            <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <KpiStatCard
                dark
                tone="brand"
                label="电池资产总量"
                value={data.summary.totalAssets}
                sparkline={buildTrend(data.summary.totalAssets, [0.58, 0.65, 0.72, 0.81, 0.92, 1])}
                icon={<Layers className="h-4 w-4 text-sky-300" />}
                sub={
                  <span className="mono whitespace-nowrap">
                    芯 {data.summary.cells} · 模组 {data.summary.modules} · 包 {data.summary.packs}
                  </span>
                }
              />
              <KpiStatCard
                dark
                tone="teal"
                label="已登记电池"
                value={assetSource.length}
                sparkline={buildTrend(assetSource.length, [0.52, 0.61, 0.76, 0.83, 0.95, 1])}
                icon={<Database className="h-4 w-4 text-teal-300" />}
                sub={
                  <span className="text-emerald-300">
                    未装配 {registeredOnlyCount} · 合格 {data.summary.passedAssets}
                  </span>
                }
              />
              <KpiStatCard
                dark
                tone="danger"
                label="质量异常数量"
                value={anomalyTotal}
                pulseAlert={anomalyTotal > 0}
                sparkline={buildTrend(Math.max(anomalyTotal, 2), [0.4, 0.8, 0.6, 1, 0.75, 0.9])}
                icon={<AlertOctagon className="h-4 w-4 text-rose-400" />}
                sub={`不合格 ${data.summary.rejectedAssets} · 待复核 ${data.summary.reviewRequiredAssets}`}
              />
              <KpiStatCard
                dark
                tone="warning"
                label="待审批数量"
                value={data.summary.pendingReleases}
                sparkline={buildTrend(Math.max(data.summary.pendingReleases, 2), [0.9, 0.7, 0.85, 0.55, 0.7, 0.6])}
                icon={<FileCheck2 className="h-4 w-4 text-amber-300" />}
                sub={`策略 v${data.summary.activePolicyVersion} 联合审批`}
              />
              <KpiStatCard
                dark
                tone="brand"
                label="待交接数量"
                value={data.summary.pendingTransfers}
                sparkline={buildTrend(Math.max(data.summary.pendingTransfers, 2), [0.5, 0.7, 0.65, 0.9, 0.8, 1])}
                icon={<Activity className="h-4 w-4 text-sky-300" />}
                sub="跨企业交接流转中"
              />
              <KpiStatCard
                dark
                tone="warning"
                label="风险预警与拦截"
                value={data.summary.rejectedTxCount}
                pulseAlert={data.summary.rejectedTxCount > 0}
                sparkline={buildTrend(Math.max(data.summary.rejectedTxCount, 2), [0.3, 0.5, 0.45, 0.85, 0.7, 1])}
                icon={<ShieldAlert className="h-4 w-4 text-amber-300" />}
                sub={`风控 ${data.summary.riskReady ? '在线' : '降级'}`}
              />
            </div>

            {/* 视觉焦点：交互式三层动力电池包爆炸结构剖面与实时数量映射 */}
            <div className="mt-5">
              <BatteryPackExplodedVisual
                cells={data.summary.cells}
                modules={data.summary.modules}
                packs={data.summary.packs}
                reviewCount={anomalyTotal}
              />
            </div>

            {/* 中部：交互式生命周期环形图 + 渐变材料分布 + 动态四组织拓扑 */}
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="navy-subcard p-5 lg:col-span-4">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
                  <Cpu className="h-4 w-4 text-teal-300" />
                  全生命周期状态分布
                </h2>
                <LifecycleDonutChart items={lifecycleDonutItems} />
              </div>

              <div className="navy-subcard p-5 lg:col-span-3">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
                  <Database className="h-4 w-4 text-sky-300" />
                  材料体系分布
                </h2>
                <div className="space-y-4">
                  {chemDistribution.map(item => {
                    const pct = assetSource.length > 0 ? Math.round((item.count / assetSource.length) * 100) : 0;
                    return (
                      <div key={item.key} className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-200">{item.label}</span>
                          <span className="mono font-bold text-white">
                            {item.count} <span className="text-slate-400">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#061120] p-[1px] ring-1 ring-white/5">
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ${item.bar}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="navy-subcard p-5 lg:col-span-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Blocks className="h-4 w-4 text-teal-300" />
                    联盟四组织协作拓扑
                  </h2>
                  <Link href="/organizations" className="text-xs font-semibold text-sky-300 hover:underline">
                    组织管理 →
                  </Link>
                </div>
                <ConsortiumTopologySvg organizations={data.organizations} ledgerHeight={data.summary.ledgerHeight} dark />
              </div>
            </div>
          </>
        )}
      </div>

      {/* 下部业务区：近期业务与安全动态 + 生产批次追溯 */}
      {data && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="card-surface card-accent-blue p-5 lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
                <ShieldCheck className="h-4 w-4 text-brand" />
                近期业务与安全拦截动态
              </h2>
              <Link href="/audit" className="text-xs font-semibold text-brand hover:underline">
                查看全部 →
              </Link>
            </div>

            {securityEvents.length === 0 ? (
              <EmptyState title="暂无事件记录" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line/70">
                <table className="tg-table text-left text-xs">
                  <thead>
                    <tr>
                      <th className="py-2.5 pr-3 pl-3">时间</th>
                      <th className="py-2.5 pr-3">类型</th>
                      <th className="py-2.5 pr-3">业务动作</th>
                      <th className="py-2.5 pr-3 text-right">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {securityEvents.map(ev => (
                      <tr key={ev.id} className="transition">
                        <td className="mono py-2.5 pr-3 pl-3 text-[11px] text-ink-secondary">{formatDateTime(ev.time)}</td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              ev.danger ? 'bg-danger/12 text-danger' : 'bg-brand/10 text-brand'
                            }`}
                          >
                            {ev.kind}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-ink">{ev.action}</div>
                          <div className="mono text-[11px] text-ink-secondary">{ev.source}</div>
                        </td>
                        <td className="mono py-2.5 pr-3 text-right font-semibold">
                          <span className={ev.danger ? 'text-danger' : 'text-success'}>{ev.outcome}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-surface card-accent-teal p-5 lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
                <GitBranch className="h-4 w-4 text-teal" />
                电芯生产批次与谱系追溯
              </h2>
              <Link href="/trace" className="text-xs font-semibold text-brand hover:underline">
                打开谱系图谱 →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.batches.slice(0, 6).map(b => (
                <Link
                  key={b.id}
                  href={`/trace?batchId=${encodeURIComponent(b.id)}`}
                  className="subtle-surface group flex items-center justify-between p-3.5 transition hover:-translate-y-0.5 hover:border-brand/50 hover:bg-white hover:shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="mono truncate text-xs font-bold text-ink">{b.id}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-secondary">
                      <OrgBadge mspId={b.makerMSP} />
                      <span>电芯 {b.cellCount}</span>
                      {b.rejectedCount > 0 && <span className="font-bold text-danger">异常 {b.rejectedCount}</span>}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
