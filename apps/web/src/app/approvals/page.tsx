'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import {
  EmptyState,
  HashChip,
  OrgBadge,
  OverviewLoadNotice,
  PageBanner,
  QualityBadge,
  SectionHeader,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { PaginationBar, SlideDrawer } from '@/components/Visuals';
import { ApprovalRingProgress, WindowCountdownBar } from '@/components/DataCharts';
import { formatDateTime, type BatteryAssetView } from '@/lib/types';
import { useOverview } from '@/lib/use-overview';

interface PolicyData {
  version: number;
  requiredOrgs: string[];
  highRiskOrgs: string[];
  maxRiskSeconds: number;
  releaseSeconds: number;
  simulationOnly: boolean;
}

interface ReleaseRecord {
  id: string;
  packId: string;
  snapshotHash: string;
  policyVersion: number;
  requiredOrgs: string[];
  approvals: { msp: string; actorId: string; digest: string; at: string }[];
  risk: {
    id: string;
    modelVersion: string;
    level: string;
    evidenceHash: string;
    issuedAt: string;
    expiresAt: string;
    signerId: string;
  };
  riskReview?: { missingMeasurements: number; qualityRules: string[]; operationRules: string[] } | null;
  state: string;
  expiresAt: string;
  txId: string;
}

function releaseState(release: ReleaseRecord, now: number) {
  return release.state === 'PENDING' &&
    (Date.parse(release.expiresAt) <= now || Date.parse(release.risk?.expiresAt) <= now)
    ? 'EXPIRED' : release.state;
}

const RISK_RULE_LABELS: Record<string, string> = {
  MISSING_MEASUREMENT: '量测记录缺少必要字段',
  VOLTAGE_OUTSIDE_DEMO_RULE: '电压超出演示规则范围',
  TEST_TEMPERATURE_OUTSIDE_REFERENCE: '测试温度超出参考范围',
  NO_MATCHING_REFERENCE_MODEL: '没有匹配该材料、型号和工况的参考模型',
  STATISTICAL_OUTLIER: '量测值偏离参考样本',
  HIGH_FREQUENCY: '近期操作频率过高',
  HIGH_REJECTION_RATIO: '近期操作拒绝比例过高',
  REPEATED_REPORT_REVERSAL: '近期质检结论反复变更',
  FAST_APPROVAL_CLUSTER: '近期多次极速审批',
  CYCLIC_APPROVAL_RELATIONSHIP: '近期跨组织审批形成闭环',
};

interface ApprovalsPayload {
  currentPolicy: PolicyData;
  releases: ReleaseRecord[];
  packs: BatteryAssetView[];
}

export default function ApprovalsPage() {
  const { actor, switching } = useIdentity();
  const { data, loading, error, load } = useOverview<ApprovalsPayload>('/api/bff/releases', switching ? undefined : actor?.name);
  const [now, setNow] = useState(() => Date.now());
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'COMPLETED' | 'EXPIRED'>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [preferredPackId, setPreferredPackId] = useState('');
  const selectedPackId = data?.packs.find(pack => pack.id === preferredPackId)?.id
    ?? data?.packs.find(pack => pack.state === 'ASSEMBLED')?.id ?? data?.packs[0]?.id ?? '';
  const [drawerReleaseId, setDrawerReleaseId] = useState<string | null>(null);
  const drawerRelease = data?.releases.find(release => release.id === drawerReleaseId);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<CommandResultState | null>(null);

  useEffect(() => {
    if (!data?.releases.some(release => release.state === 'PENDING')) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data]);

  async function requestRelease(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPackId || busy || loading || error !== null) return;
    setBusy(true);
    setBanner(null);
    try {
      const id = `ui-rel-${Date.now().toString(36)}`;
      const res = await fetch('/api/bff/release-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, packId: selectedPackId }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: `放行申请 ${id} 已上链创建，并绑定服务端签名风险凭证`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await load();
      } else {
        setBanner({
          ok: false,
          title: `放行申请被拦截（当前身份: ${actor?.name ?? '—'}）`,
          requestId: json.requestId,
          stage: json.stage ?? 'rejected',
          errorCode: json.errorCode ?? json.code ?? 'FORBIDDEN',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function releaseAction(resource: 'release-approvals' | 'release-finalizations', release: ReleaseRecord, attemptedAt: number) {
    if (busy || loading || error !== null || releaseState(release, attemptedAt) !== 'PENDING') return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/bff/commands/${resource}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: { id: release.id } }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: resource === 'release-approvals' ? `已代表 ${actor?.mspId} 签署批准` : `电池包最终放行完成 (RELEASED)`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await load();
      } else {
        setBanner({
          ok: false,
          title: `联合审批/放行操作被拒绝（当前身份: ${actor?.name ?? '—'}）`,
          requestId: json.requestId,
          stage: json.stage ?? 'rejected',
          errorCode: json.errorCode ?? json.code ?? 'REJECTED',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const allReleases = data?.releases ?? [];
  const filteredReleases = allReleases.filter(r => statusFilter === 'ALL' || releaseState(r, now) === statusFilter);
  const totalPages = Math.max(1, Math.ceil(filteredReleases.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedReleases = filteredReleases.slice((safePage - 1) * pageSize, safePage * pageSize);

  const packMap = new Map((data?.packs ?? []).map(p => [p.id, p]));
  const pendingCount = allReleases.filter(r => releaseState(r, now) === 'PENDING').length;
  const completedCount = allReleases.filter(r => r.state === 'COMPLETED').length;

  return (
    <div className="space-y-6">
      <PageBanner
        title="多组织联合审批中心"
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/policies"
              className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              策略管理 {data ? `(v${data.currentPolicy.version})` : ''} →
            </Link>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#17324f]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        }
      />

      <OverviewLoadNotice loading={loading} error={error} hasData={Boolean(data)} onRetry={() => void load()} />
      {data && <>
      {/* 顶部统计 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">放行申请总数</div>
          <div className="mono mt-1 text-2xl font-bold text-[#10243A]">{allReleases.length}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">待联合审批 (PENDING)</div>
          <div className="mono mt-1 text-2xl font-bold text-[#D99A2B]">{pendingCount}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">已批准放行 (COMPLETED)</div>
          <div className="mono mt-1 text-2xl font-bold text-[#159B76]">{completedCount}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">当前生效策略版本</div>
          <div className="mono mt-1 text-2xl font-bold text-[#2563EB]">v{data?.currentPolicy.version ?? '—'}</div>
        </div>
      </div>

      {banner && <TxResultBanner result={banner} onClose={() => setBanner(null)} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* 左：放行申请与审批矩阵列表 */}
        <div className="card-surface p-5 lg:col-span-8">
          <SectionHeader
            title="四组织联合审批矩阵（按实际策略动态渲染必需组织）"
            subtitle="常规放行仅需所需组织批准；高风险凭证自动附加 RecycleOrgMSP 独立复核"
            icon={<ClipboardCheck className="h-4 w-4 text-[#2563EB]" />}
            action={
              <div className="flex flex-wrap gap-1 rounded-lg bg-[#EDF2F7] p-1 text-xs font-semibold">
                {(['ALL', 'PENDING', 'COMPLETED', 'EXPIRED'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => {
                      setStatusFilter(st);
                      setPage(1);
                    }}
                    className={`rounded-md px-3 py-1 transition ${
                      statusFilter === st ? 'bg-white text-[#10243A] shadow-2xs' : 'text-[#64748B]'
                    }`}
                  >
                    {st === 'ALL' ? '全部' : st === 'PENDING' ? '待审批' : st === 'EXPIRED' ? '已过期' : '已放行'}
                  </button>
                ))}
              </div>
            }
          />

          {pagedReleases.length === 0 ? (
            <EmptyState title="该筛选条件下暂无放行申请" />
          ) : (
            <div className="space-y-4">
              {pagedReleases.map(rel => {
                const approvalMap = new Map(rel.approvals.map(a => [a.msp, a]));
                const pack = packMap.get(rel.packId);
                const state = releaseState(rel, now);
                const isHighRisk = rel.risk?.level === 'HIGH' || rel.requiredOrgs.includes('RecycleOrgMSP');
                return (
                  <div key={rel.id} className="subtle-surface p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <ApprovalRingProgress approved={rel.approvals.length} required={rel.requiredOrgs.length} />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mono font-bold text-[#10243A]">{rel.id}</span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              state === 'COMPLETED'
                                ? 'bg-[#159B76]/15 text-[#159B76]'
                                : state === 'EXPIRED' ? 'bg-[#DC5353]/12 text-[#DC5353]' : 'bg-[#D99A2B]/15 text-[#b07612]'
                            }`}
                          >
                            {state === 'COMPLETED' ? '已批准放行 (COMPLETED)' : state === 'EXPIRED' ? '已过期' : '待联合审批 (PENDING)'}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              isHighRisk ? 'bg-[#DC5353]/12 text-[#DC5353]' : 'bg-[#2563EB]/10 text-[#2563EB]'
                            }`}
                          >
                            风险等级：{rel.risk?.level ?? 'NORMAL'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDrawerReleaseId(rel.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#dce4ee] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#172B3A] hover:bg-slate-50"
                      >
                        <Eye className="h-3 w-3" />
                        放行详情
                      </button>
                    </div>

                    <WindowCountdownBar
                      expiresAt={rel.expiresAt}
                      windowSeconds={data?.currentPolicy.releaseSeconds ?? 600}
                      now={now}
                      completed={state === 'COMPLETED'}
                    />

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#64748B]">
                      <span>
                        PACK: <strong className="mono text-[#172B3A]">{rel.packId}</strong>
                      </span>
                      {pack && <QualityBadge quality={pack.quality} />}
                      <span className="mono">策略 v{rel.policyVersion}</span>
                      <HashChip value={rel.txId} label="tx" />
                    </div>

                    {/* 仅按 rel.requiredOrgs 动态展示必需组织 */}
                    <div className={`mt-3 grid grid-cols-2 gap-2 ${rel.requiredOrgs.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                      {rel.requiredOrgs.map(org => {
                        const sig = approvalMap.get(org);
                        return (
                          <div
                            key={org}
                            className={`rounded-lg border p-2.5 ${
                              sig
                                ? 'border-[#159B76]/35 bg-white text-[#159B76]'
                                : 'border-dashed border-[#dce4ee] bg-white/70 text-[#64748B]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold">{org.replace('MSP', '')}</span>
                              {sig ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-[10px]">待审批</span>}
                            </div>
                            <div className="mono mt-1 truncate text-[10px] text-[#64748B]">
                              {sig ? formatDateTime(sig.at) : '需 approver 签名'}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {state === 'EXPIRED' && <p className="mt-3 text-[#DC5353]">申请或风险凭证已过期。请重新发起放行申请。</p>}
                    {(state === 'PENDING' || state === 'EXPIRED') && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-[#dce4ee] pt-3">
                        <button
                          disabled={busy || loading || error !== null || state === 'EXPIRED'}
                          onClick={() => void releaseAction('release-approvals', rel, Date.now())}
                          className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          以 {actor?.name} 批准
                        </button>
                        <button
                          disabled={busy || loading || error !== null || state === 'EXPIRED'}
                          onClick={() => void releaseAction('release-finalizations', rel, Date.now())}
                          className="rounded-lg bg-[#10243A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#17324f] disabled:opacity-60"
                        >
                          执行最终放行 (Finalize)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <PaginationBar page={safePage} totalPages={totalPages} totalItems={filteredReleases.length} onPageChange={setPage} />
        </div>

        {/* 右：发起 PACK 放行申请 */}
        <div className="card-surface p-5 lg:col-span-4">
          <SectionHeader
            title="发起 PACK 放行申请"
            subtitle="仅 PackOrgMSP release 可提交；链码强制核验全部电芯最新质检"
          />

          <form onSubmit={requestRelease} className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-[#64748B]">选择电池包 (PACK)</label>
              <select
                value={selectedPackId}
                onChange={e => setPreferredPackId(e.target.value)}
                className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
              >
                {(data?.packs ?? []).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.state} · {p.quality}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={busy || loading || error !== null || !selectedPackId}
              className="w-full rounded-lg bg-[#10243A] py-2.5 text-xs font-semibold text-white hover:bg-[#17324f] disabled:opacity-60"
            >
              {busy ? '风控评估与链码提交中...' : '生成风险凭证并提交放行申请'}
            </button>
          </form>

          {data?.currentPolicy && (
            <div className="mt-5 border-t border-[#EDF2F7] pt-4 text-xs">
              <div className="mb-2 font-bold text-[#172B3A]">当前策略 v{data.currentPolicy.version} 必需组织</div>
              <div className="flex flex-wrap gap-1.5">
                {data.currentPolicy.requiredOrgs.map(o => (
                  <OrgBadge key={o} mspId={o} />
                ))}
              </div>
              <div className="mt-2 text-[11px] text-[#64748B]">
                高风险附加组织：{data.currentPolicy.highRiskOrgs.join(', ')}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 放行详情抽屉 */}
      <SlideDrawer
        open={Boolean(drawerRelease)}
        onClose={() => setDrawerReleaseId(null)}
        title={drawerRelease ? `放行审批详情 · ${drawerRelease.id}` : ''}
        subtitle={drawerRelease ? `目标 PACK：${drawerRelease.packId}` : undefined}
      >
        {drawerRelease && (
          <div className="space-y-4 text-xs">
            <div className="subtle-surface space-y-2 p-4">
              <div className="flex justify-between">
                <span className="text-[#64748B]">放行单号</span>
                <span className="mono font-bold">{drawerRelease.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">审批状态</span>
                <span className="font-bold">{releaseState(drawerRelease, now) === 'EXPIRED' ? '已过期' : drawerRelease.state}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">申请有效期至</span>
                <span className="mono">{formatDateTime(drawerRelease.expiresAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">风险凭证有效期至</span>
                <span className="mono">{formatDateTime(drawerRelease.risk?.expiresAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">快照哈希 (snapshotHash)</span>
                <HashChip value={drawerRelease.snapshotHash} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">策略版本</span>
                <span className="mono font-semibold">v{drawerRelease.policyVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">AI 风险凭证</span>
                <span className="mono font-semibold">
                  {drawerRelease.risk?.id} · {drawerRelease.risk?.level} ({drawerRelease.risk?.modelVersion})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Fabric 交易</span>
                <HashChip value={drawerRelease.txId} />
              </div>
            </div>

            <div className="subtle-surface space-y-2 p-4">
              <div className="font-bold text-[#172B3A]">风险判定依据</div>
              {drawerRelease.riskReview ? (
                <ul className="list-disc space-y-1 pl-4">
                  {drawerRelease.riskReview.missingMeasurements > 0 && (
                    <li>{drawerRelease.riskReview.missingMeasurements} 个电芯缺少已导入的量测记录，需要独立复核</li>
                  )}
                  {drawerRelease.riskReview.qualityRules.map(rule => (
                    <li key={rule}>质量量测 · {RISK_RULE_LABELS[rule] ?? rule}</li>
                  ))}
                  {drawerRelease.riskReview.operationRules.map(rule => (
                    <li key={rule}>平台近 5 分钟的操作记录 · {RISK_RULE_LABELS[rule] ?? rule}</li>
                  ))}
                  {drawerRelease.risk?.level === 'LOW' && <li>本次评估未触发复核规则</li>}
                </ul>
              ) : (
                <p className="text-[#64748B]">该凭证未保存规则明细，无法追溯具体触发原因。</p>
              )}
            </div>

            <div>
              <div className="mb-2 font-bold text-[#172B3A]">多组织审批签章明细</div>
              <div className="space-y-2">
                {drawerRelease.approvals.map(a => (
                  <div key={a.msp} className="subtle-surface flex items-center justify-between p-3">
                    <div>
                      <OrgBadge mspId={a.msp} />
                      <div className="mt-1">
                        <HashChip value={a.digest} label="签名摘要" />
                      </div>
                    </div>
                    <span className="mono text-[11px] text-[#64748B]">{formatDateTime(a.at)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#2563EB]/25 bg-[#2563EB]/8 p-3.5 text-[11px] text-[#172B3A]">
              <div className="flex items-center gap-1.5 font-bold text-[#2563EB]">
                <ShieldAlert className="h-4 w-4" />
                链码放行判定依据
              </div>
              <p className="mt-1 text-[#64748B]">
                Go 链码逐一核验 snapshot 中所有电芯、模组与 PACK 本身的最新质检均为 <code className="mono">QC_PASSED</code>，且风险凭证未过期并与策略 v
                {drawerRelease.policyVersion} 匹配后才允许进入 <code className="mono">RELEASED</code>。
              </p>
            </div>
          </div>
        )}
      </SlideDrawer>
      </>}
    </div>
  );
}
