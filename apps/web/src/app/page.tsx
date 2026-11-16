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
import { DemoTag, EmptyState, HashChip, OrgBadge } from '@/components/Badges';
import { ConsortiumTopologySvg, LifecycleDonutChart } from '@/components/Visuals';
import {
  CHEMISTRY_LABELS,
  formatDateTime,
  formatServiceAge,
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

export default function DashboardPage() {
  const { actor } = useIdentity();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [allAssets, setAllAssets] = useState<BatteryAssetView[]>([]);
  const [auditTxs, setAuditTxs] = useState<AuditSummary['transactions']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, assetsRes, auditRes] = await Promise.all([
        fetch('/api/bff/dashboard', { cache: 'no-store' }),
        fetch('/api/bff/assets', { cache: 'no-store' }),
        fetch('/api/bff/audit', { cache: 'no-store' }),
      ]);
      const dashJson = await dashRes.json();
      if (!dashRes.ok) throw new Error(dashJson.code ?? `HTTP ${dashRes.status}`);
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
    void load();
  }, [load, actor?.name]);

  const assetSource = allAssets.length > 0 ? allAssets : (data?.recentAssets ?? []);
  const registeredOnlyCount = assetSource.filter(a => a.state === 'REGISTERED').length;
  const assembledCount = assetSource.filter(a => ['ASSEMBLED', 'RELEASED', 'INSTALLED'].includes(a.state)).length;
  const inUseCount = assetSource.filter(a => a.state === 'IN_USE').length;
  const retiredCount = assetSource.filter(a => ['RETIRED', 'RECEIVED_FOR_RECYCLING'].includes(a.state)).length;
  const scrappedCount = assetSource.filter(a => a.state === 'PROCESSED' && a.scrapped).length;

  const lifecycleDonutItems = [
    { key: 'unmounted', label: '未装配 (REGISTERED)', count: registeredOnlyCount, color: '#94A3B8' },
    { key: 'assembled', label: '已装配/放行', count: assembledCount, color: '#2563EB' },
    { key: 'in_use', label: '使用中 (IN_USE)', count: inUseCount, color: '#0F9D8A' },
    { key: 'retired', label: '已退役/待回收', count: retiredCount, color: '#D99A2B' },
    { key: 'scrapped', label: '已报废确认', count: scrappedCount, color: '#DC5353' },
  ];

  const lfpCount = assetSource.filter(a => a.chemistry === 'LFP').length;
  const ternaryCount = assetSource.filter(a => a.chemistry === 'TERNARY').length;
  const sodiumCount = assetSource.filter(a => a.chemistry === 'SODIUM_ION').length;
  const otherChemCount = Math.max(0, assetSource.length - lfpCount - ternaryCount - sodiumCount);

  const chemDistribution = [
    { key: 'LFP', label: CHEMISTRY_LABELS.LFP, count: lfpCount, color: 'bg-[#0F9D8A]' },
    { key: 'TERNARY', label: CHEMISTRY_LABELS.TERNARY, count: ternaryCount, color: 'bg-[#2563EB]' },
    ...(sodiumCount > 0 ? [{ key: 'SODIUM_ION', label: CHEMISTRY_LABELS.SODIUM_ION, count: sodiumCount, color: 'bg-[#3185D8]' }] : []),
    ...(otherChemCount > 0 ? [{ key: 'OTHER', label: '其他标准体系', count: otherChemCount, color: 'bg-slate-400' }] : []),
  ];

  const standaloneSample = assetSource.find(a => a.state === 'REGISTERED' && !a.parentId);
  const liveSample = assetSource.find(a => a.type === 'PACK' && a.state === 'IN_USE');
  const scrappedSample = assetSource.find(a => a.type === 'PACK' && a.scrapped);

  // Merge security & business timeline events from real backend records
  const securityEvents = [
    ...auditTxs.slice(0, 8).map(tx => ({
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
                : '交易验证',
      action: tx.action,
      source: tx.resourceId ?? tx.requestId,
      outcome: tx.errorCode ?? tx.stage,
      danger: tx.stage === 'rejected' || tx.stage === 'invalid',
    })),
  ];

  return (
    <div className="space-y-6">
      {/* 深海军蓝工业监控中心主区 */}
      <div className="navy-control-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1e3a5c] pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono rounded bg-[#2563EB]/25 px-2 py-0.5 text-[10px] font-bold tracking-wider text-blue-200 ring-1 ring-blue-400/30">
                01 · SECURITY COMMAND COCKPIT
              </span>
              <span className="inline-flex items-center gap-1.5 rounded bg-[#159B76]/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-[#159B76]" />
                真实 Fabric 四组织实链运行
              </span>
              <DemoTag label="演示数据与真实链上交易混合标注" />
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-white sm:text-2xl">
              动力电池全生命周期可信追溯与主动安全驾驶舱
            </h1>
            <p className="mt-1 text-xs text-slate-300">
              基于 Hyperledger Fabric 2.5.16 与 AI 动态信任 · 遂宁锂电产业链安全态势实时监控中心
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/identity"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <QrCode className="h-3.5 w-3.5" />
              24 位码查身份证
            </Link>
            <Link
              href="/lab"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#DC5353]/50 bg-[#DC5353]/15 px-3.5 py-2 text-xs font-semibold text-red-200 hover:bg-[#DC5353]/25"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              A1–A8 攻防实验室
            </Link>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#10243A] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-[#17324f]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新态势
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-[#DC5353]/50 bg-[#DC5353]/15 px-4 py-3 text-sm text-red-200">
            读取驾驶舱失败：{error}
          </div>
        )}

        {data && (
          <>
            {/* 顶部 6 大核心指标 */}
            <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <div className="navy-subcard p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>电池资产总量</span>
                  <Layers className="h-4 w-4 text-[#3185D8]" />
                </div>
                <div className="mono mt-2 text-2xl font-bold text-white">{data.summary.totalAssets}</div>
                <div className="mono mt-1 text-[10px] text-slate-400">
                  电芯 {data.summary.cells} · 模组 {data.summary.modules} · PACK {data.summary.packs}
                </div>
              </div>

              <div className="navy-subcard p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>已登记电池</span>
                  <Database className="h-4 w-4 text-[#0F9D8A]" />
                </div>
                <div className="mono mt-2 text-2xl font-bold text-white">{assetSource.length}</div>
                <div className="mt-1 text-[10px] text-emerald-300">
                  未装配 {registeredOnlyCount} · 合格 {data.summary.passedAssets}
                </div>
              </div>

              <div className="navy-subcard p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>质量异常数量</span>
                  <AlertOctagon className="h-4 w-4 text-[#DC5353]" />
                </div>
                <div className="mono mt-2 text-2xl font-bold text-[#DC5353]">
                  {data.summary.rejectedAssets + data.summary.reviewRequiredAssets}
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  不合格 {data.summary.rejectedAssets} · 待复核 {data.summary.reviewRequiredAssets} · 待检 {data.summary.notTestedAssets}
                </div>
              </div>

              <div className="navy-subcard p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>待审批数量</span>
                  <FileCheck2 className="h-4 w-4 text-[#D99A2B]" />
                </div>
                <div className="mono mt-2 text-2xl font-bold text-white">{data.summary.pendingReleases}</div>
                <div className="mt-1 text-[10px] text-slate-400">策略 v{data.summary.activePolicyVersion} 联合审批</div>
              </div>

              <div className="navy-subcard p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>待交接数量</span>
                  <Activity className="h-4 w-4 text-[#3185D8]" />
                </div>
                <div className="mono mt-2 text-2xl font-bold text-white">{data.summary.pendingTransfers}</div>
                <div className="mt-1 text-[10px] text-slate-400">双签交接状态 SENT</div>
              </div>

              <div className="navy-subcard p-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>风险预警与拦截</span>
                  <ShieldAlert className="h-4 w-4 text-[#D99A2B]" />
                </div>
                <div className="mono mt-2 text-2xl font-bold text-[#D99A2B]">{data.summary.rejectedTxCount}</div>
                <div className="mt-1 text-[10px] text-slate-400">
                  AI 风控 {data.summary.riskReady ? '在线' : '降级'} · 审计 {data.summary.auditAnchoredTotal} 条
                </div>
              </div>
            </div>

            {/* 中部：生命周期环形图 + 材料分布 + 四组织拓扑 */}
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="navy-subcard p-5 lg:col-span-4">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
                  <Cpu className="h-4 w-4 text-[#0F9D8A]" />
                  全生命周期分布（环形统计）
                </h2>
                <LifecycleDonutChart items={lifecycleDonutItems} />
              </div>

              <div className="navy-subcard flex flex-col justify-between p-5 lg:col-span-3">
                <div>
                  <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-white">
                    <Database className="h-4 w-4 text-[#2563EB]" />
                    材料类型分布
                  </h2>
                  <p className="mb-4 text-[11px] text-slate-400">依据 GB/T 34014—2017+A1:2026 第 5 位</p>
                  <div className="space-y-3">
                    {chemDistribution.map(item => {
                      const pct = assetSource.length > 0 ? Math.round((item.count / assetSource.length) * 100) : 0;
                      return (
                        <div key={item.key} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-200">{item.label}</span>
                            <span className="mono font-bold text-white">
                              {item.count} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[#0B192C]">
                            <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 border-t border-[#1e3a5c] pt-3 text-[11px]">
                  <div className="mb-2 font-semibold text-slate-300">三类典型演示直通（DEMO）</div>
                  <div className="space-y-1.5">
                    {[
                      { label: '未装配电芯', sample: standaloneSample },
                      { label: '在用三元包', sample: liveSample },
                      { label: '已报废包', sample: scrappedSample },
                    ].map(x =>
                      x.sample ? (
                        <Link
                          key={x.label}
                          href={`/identity?code=${encodeURIComponent(x.sample.code)}`}
                          className="flex items-center justify-between rounded bg-[#0B192C] px-2.5 py-1.5 text-slate-200 hover:bg-[#17324f]"
                        >
                          <span>{x.label}</span>
                          <span className="mono text-[10px] text-[#0F9D8A]">
                            {x.sample.code.slice(-8)} {x.sample.serviceAge ? `· ${formatServiceAge(x.sample.serviceAge)}` : ''} →
                          </span>
                        </Link>
                      ) : null,
                    )}
                  </div>
                </div>
              </div>

              <div className="navy-subcard p-5 lg:col-span-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Blocks className="h-4 w-4 text-[#0F9D8A]" />
                    四组织 Hyperledger Fabric 协作拓扑
                  </h2>
                  <Link href="/organizations" className="text-[11px] font-semibold text-blue-300 hover:underline">
                    组织与权限 →
                  </Link>
                </div>
                <ConsortiumTopologySvg organizations={data.organizations} ledgerHeight={data.summary.ledgerHeight} dark />
              </div>
            </div>
          </>
        )}
      </div>

      {/* 下部浅色精细业务区：安全事件动态 + 区块链状态 + 批次快捷追溯 */}
      {data && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* 安全事件动态 */}
          <div className="card-surface p-5 lg:col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#172B3A]">
                  <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
                  安全事件动态流（真实交易与审计记录）
                </h2>
                <p className="mt-0.5 text-[11px] text-[#64748B]">涵盖异常拦截、联合审批、交易四节点验证与摘要锚定</p>
              </div>
              <Link href="/audit" className="text-xs font-semibold text-[#2563EB] hover:underline">
                完整审计簿 →
              </Link>
            </div>

            {securityEvents.length === 0 ? (
              <EmptyState title="暂无安全事件记录" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#dce4ee] text-[11px] text-[#64748B]">
                    <tr>
                      <th className="py-2 pr-3">时间</th>
                      <th className="py-2 pr-3">事件类型</th>
                      <th className="py-2 pr-3">操作 / 目标</th>
                      <th className="py-2 text-right">处理结果</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDF2F7]">
                    {securityEvents.map(ev => (
                      <tr key={ev.id} className="hover:bg-[#F4F7FA]">
                        <td className="mono py-2.5 pr-3 text-[11px] text-[#64748B]">{formatDateTime(ev.time)}</td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              ev.danger ? 'bg-[#DC5353]/12 text-[#DC5353]' : 'bg-[#2563EB]/10 text-[#2563EB]'
                            }`}
                          >
                            {ev.kind}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[#172B3A]">{ev.action}</div>
                          <div className="mono text-[10px] text-[#64748B]">{ev.source}</div>
                        </td>
                        <td className="mono py-2.5 text-right font-semibold">
                          <span className={ev.danger ? 'text-[#DC5353]' : 'text-[#159B76]'}>{ev.outcome}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 区块链状态与可重建索引同步 + 批次追溯 */}
          <div className="space-y-5 lg:col-span-6">
            <div className="card-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#172B3A]">
                  <Blocks className="h-4 w-4 text-[#0F9D8A]" />
                  区块链账本与 PostgreSQL 索引同步状态
                </h2>
                <span className="rounded bg-[#159B76]/10 px-2 py-0.5 text-[10px] font-bold text-[#159B76]">
                  真实本地 Fabric 共识数据
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div className="subtle-surface p-3">
                  <div className="text-[10px] text-[#64748B]">通道 Channel</div>
                  <div className="mono mt-1 font-bold text-[#172B3A]">batterybusiness</div>
                </div>
                <div className="subtle-surface p-3">
                  <div className="text-[10px] text-[#64748B]">链码与版本</div>
                  <div className="mono mt-1 font-bold text-[#172B3A]">
                    {data.summary.chaincode.name} v{data.summary.chaincode.version} (seq {data.summary.chaincode.sequence})
                  </div>
                </div>
                <div className="subtle-surface p-3">
                  <div className="text-[10px] text-[#64748B]">最新区块高度</div>
                  <div className="mono mt-1 font-bold text-[#2563EB]">#{data.summary.ledgerHeight}</div>
                </div>
                <div className="subtle-surface p-3">
                  <div className="text-[10px] text-[#64748B]">PG 索引同步高度</div>
                  <div className="mono mt-1 font-bold text-[#159B76]">
                    #{data.summary.indexedBlock ?? '—'}（{data.summary.stale ? '追赶中' : '0 块延迟'}）
                  </div>
                </div>
                <div className="subtle-surface p-3">
                  <div className="text-[10px] text-[#64748B]">四 Peer 核验</div>
                  <div className="mt-1 font-bold text-[#159B76]">4/4 同步一致</div>
                </div>
                <div className="subtle-surface p-3">
                  <div className="text-[10px] text-[#64748B]">安全日志锚定</div>
                  <div className="mono mt-1 font-bold text-[#172B3A]">
                    {data.summary.auditAnchoredTotal} / {data.summary.auditLogsTotal}
                  </div>
                </div>
              </div>
            </div>

            <div className="card-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#172B3A]">
                  <GitBranch className="h-4 w-4 text-[#2563EB]" />
                  电芯生产批次与影响追溯入口
                </h2>
                <Link href="/trace" className="text-xs font-semibold text-[#2563EB] hover:underline">
                  打开谱系图谱 →
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {data.batches.slice(0, 4).map(b => (
                  <Link
                    key={b.id}
                    href={`/trace?batchId=${encodeURIComponent(b.id)}`}
                    className="subtle-surface flex items-center justify-between p-3 transition hover:border-[#2563EB]/50 hover:bg-blue-50/40"
                  >
                    <div className="min-w-0">
                      <div className="mono truncate text-xs font-bold text-[#172B3A]">{b.id}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-[#64748B]">
                        <OrgBadge mspId={b.makerMSP} />
                        <span>电芯 {b.cellCount}</span>
                        {b.rejectedCount > 0 && <span className="font-bold text-[#DC5353]">异常 {b.rejectedCount}</span>}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#64748B]" />
                  </Link>
                ))}
              </div>
              {data.recentAlerts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#EDF2F7] pt-3 text-[11px] text-[#64748B]">
                  <span>最新安全日志摘要：</span>
                  <HashChip value={data.recentAlerts[0].evidenceHash} label={`#${data.recentAlerts[0].id}`} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
