'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import {
  EmptyState,
  HashChip,
  OrgBadge,
  PageBanner,
  SectionHeader,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { PolicyImpactBars } from '@/components/DataCharts';
import { formatDateTime } from '@/lib/types';

interface PolicyData {
  version: number;
  requiredOrgs: string[];
  highRiskOrgs: string[];
  maxRiskSeconds: number;
  releaseSeconds: number;
  simulationOnly: boolean;
}

interface PolicyPreviewRecord {
  id: string;
  policyHash: string;
  baseVersion: string;
  testsHash: string;
  passed: boolean;
  createdAt: string;
  report: {
    candidateVersion: number;
    releaseWindow?: {before: number; after: number};
    changedFields: string[];
    authorizationDifference: { before: string[]; after: string[] };
    newUnauthorizedReleasePathsInPresetCases: number | null;
    ruleProof?: { packageId: string; ruleSourceHash: string; verified: boolean };
    tests: { name: string; result: string; elapsedSeconds: number }[];
  };
}

interface PolicyCandidate {
  id: string;
  baseVersion: number;
  state: string;
  testsHash: string;
  approvals: { msp: string; at: string }[];
  policy: PolicyData;
}

interface PoliciesPayload {
  currentPolicy: PolicyData;
  candidates: PolicyCandidate[];
  previews: PolicyPreviewRecord[];
}

export default function PoliciesPage() {
  const { actor } = useIdentity();
  const [data, setData] = useState<PoliciesPayload | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [candidateDrafts, setCandidateDrafts] = useState<
    Record<string, { id: string; policy: PolicyData; testsHash: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [secondsInput, setSecondsInput] = useState<string | null>(null);
  const secondsText = secondsInput ?? String(Math.max(60, (data?.currentPolicy.releaseSeconds ?? 600) - 60));
  const seconds = Number(secondsText);
  const validSeconds = /^\d+$/.test(secondsText) && Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 3600;
  const [banner, setBanner] = useState<CommandResultState | null>(null);
  const [confirmActivateId, setConfirmActivateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bff/releases', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as PoliciesPayload;
        setData(json);
        if (json.previews.length > 0) setExpandedId(prev => prev ?? json.previews[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runPolicyPreview(mode: 'weak' | 'safe') {
    if (!data?.currentPolicy || (mode === 'safe' && !validSeconds)) return;
    setBusy(true);
    setBanner(null);
    try {
      const id = `ui-pol-${mode}-${Date.now().toString(36)}`;
      const candidatePolicy =
        mode === 'weak'
          ? { ...data.currentPolicy, version: data.currentPolicy.version + 1, requiredOrgs: ['PackOrgMSP'] }
          : {
              ...data.currentPolicy,
              version: data.currentPolicy.version + 1,
              releaseSeconds: seconds,
            };

      const res = await fetch('/api/bff/policy-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, policy: candidatePolicy }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBanner({
          ok: false,
          title: `隔离策略预演被拒绝（需组织 admin 身份，当前: ${actor?.name ?? '—'}）`,
          errorCode: json.code ?? `HTTP_${res.status}`,
        });
      } else {
        const passed = Boolean(json.report?.passed);
        if (passed && json.testsHash) {
          setCandidateDrafts(prev => ({
            ...prev,
            [id]: { id, policy: candidatePolicy, testsHash: String(json.testsHash) },
          }));
        }
        setBanner({
          ok: passed,
          title: passed
            ? `候选策略 v${candidatePolicy.version} 通过本次隔离回归`
            : '本次隔离回归未通过，候选策略已停止提议。可在执行明细中查看结果。',
          errorCode: passed ? undefined : 'UNSAFE_POLICY_BLOCKED',
        });
        setExpandedId(id);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function executePolicyCmd(
    resource: 'policy-candidates' | 'policy-approvals' | 'policy-activations',
    payload: Record<string, unknown>,
    label: string,
  ) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/bff/commands/${resource}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: `${label} 已上链确认`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await load();
      } else {
        setBanner({
          ok: false,
          title: `${label} 被拦截`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage ?? 'rejected',
          errorCode: json.errorCode ?? json.code ?? `HTTP_${res.status}`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageBanner
        title="安全策略变更预演与多组织治理中心"
        right={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#17324f]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新策略状态
          </button>
        }
      />

      {banner && <TxResultBanner result={banner} onClose={() => setBanner(null)} />}

      {data && (
        <PolicyImpactBars
          currentRequired={data.currentPolicy.requiredOrgs.length}
          currentHighRisk={data.currentPolicy.highRiskOrgs.length}
          currentWindowSec={data.currentPolicy.releaseSeconds}
          candidateWindowSec={validSeconds ? Number(secondsText) : data.currentPolicy.releaseSeconds}
          candidateCount={data.candidates.length}
        />
      )}

      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 左：当前策略 + 实时隔离回归推演台 */}
          <div className="space-y-5 lg:col-span-5">
            <div className="card-surface p-5">
              <SectionHeader
                title={`当前激活策略：v${data.currentPolicy.version}`}
                subtitle="链上权威策略配置 · 受控最低安全约束"
                icon={<Shield className="h-4 w-4 text-[#159B76]" />}
              />

              <dl className="space-y-3 text-xs">
                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">常规放行必需审批组织</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.currentPolicy.requiredOrgs.map(o => (
                      <OrgBadge key={o} mspId={o} />
                    ))}
                  </dd>
                </div>
                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">高风险附加独立复核组织</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.currentPolicy.highRiskOrgs.map(o => (
                      <OrgBadge key={o} mspId={o} />
                    ))}
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="subtle-surface p-3">
                    <dt className="text-[#64748B]">风控凭证最长有效期</dt>
                    <dd className="mono mt-1 text-base font-bold text-[#172B3A]">{data.currentPolicy.maxRiskSeconds} s</dd>
                  </div>
                  <div className="subtle-surface p-3">
                    <dt className="text-[#64748B]">放行审批窗口期</dt>
                    <dd className="mono mt-1 text-base font-bold text-[#172B3A]">{data.currentPolicy.releaseSeconds} s</dd>
                  </div>
                </div>
              </dl>

              <div className="mt-5 border-t border-[#EDF2F7] pt-4">
                <div className="mb-2 text-xs font-bold text-[#172B3A]">
                  隔离安全回归推演对照（当前身份：{actor?.name ?? '—'}，需 admin）
                </div>
                <label className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-ink">
                  <span>候选放行窗口（秒）</span>
                  <input
                    type="number"
                    min={60}
                    max={3600}
                    step={1}
                    className="mono w-24 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink shadow-2xs transition focus:border-brand focus:outline-none"
                    value={secondsText}
                    onChange={e => setSecondsInput(e.target.value)}
                    aria-invalid={!validSeconds}
                  />
                </label>
                {!validSeconds && <p role="alert" className="mb-2 text-xs text-red-700">请输入 60 到 3600 之间的整数。</p>}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    disabled={busy}
                    onClick={() => void runPolicyPreview('weak')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#DC5353]/40 bg-[#DC5353]/10 px-3 py-2 text-xs font-bold text-[#DC5353] hover:bg-[#DC5353]/15 disabled:opacity-60"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    推演弱化策略（单方）
                  </button>
                  <button
                    disabled={busy || !validSeconds || actor?.role !== 'admin'}
                    onClick={() => void runPolicyPreview('safe')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#159B76]/40 bg-[#159B76]/10 px-3 py-2 text-xs font-bold text-[#159B76] hover:bg-[#159B76]/15 disabled:opacity-60"
                  >
                    <Play className="h-3.5 w-3.5" />
                    推演合规策略
                  </button>
                </div>
              </div>
            </div>

            {/* 候选与激活历史 */}
            <div className="card-surface p-5">
              <SectionHeader
                title="策略候选提案与四方审批"
              />
              {data.candidates.length === 0 ? (
                <EmptyState title="暂无候选策略记录" />
              ) : (
                <div className="space-y-2.5 text-xs">
                  {data.candidates.map(c => (
                    <div key={c.id} className="subtle-surface p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono truncate font-bold text-[#172B3A]">{c.id}</span>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                            c.state === 'ACTIVE' ? 'bg-[#159B76]/15 text-[#159B76]' : 'bg-[#D99A2B]/15 text-[#b07612]'
                          }`}
                        >
                          {c.state} (v{c.policy.version})
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.approvals.map(a => (
                          <OrgBadge key={a.msp} mspId={a.msp} />
                        ))}
                      </div>
                      {c.state !== 'ACTIVE' && (() => {
                        const alreadySigned = Boolean(actor?.mspId && c.approvals.some(a => a.msp === actor.mspId));
                        const canApprove = actor?.role === 'auditor' && !alreadySigned;
                        const allFourApproved = c.approvals.length >= 4;
                        const canActivate = actor?.role === 'admin' && allFourApproved;
                        const confirming = confirmActivateId === c.id;
                        return (
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[#dce4ee] pt-2">
                            <button
                              type="button"
                              disabled={busy || !canApprove}
                              title={alreadySigned ? '本组织已完成审计批准' : actor?.role !== 'auditor' ? '需切换为审计员 (auditor) 身份批准' : '批准该候选策略'}
                              onClick={() => void executePolicyCmd('policy-approvals', { id: c.id }, `批准候选 ${c.id}`)}
                              className="cursor-pointer rounded-md bg-[#10243A] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#17324f] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {alreadySigned ? '本组织已批准' : actor?.role === 'auditor' ? `审计员批准 (${actor.mspId})` : '审计员批准 (需 auditor)'}
                            </button>
                            <button
                              type="button"
                              disabled={busy || !canActivate}
                              title={!allFourApproved ? `需四家组织全签后激活（当前 ${c.approvals.length}/4）` : actor?.role !== 'admin' ? '需组织管理员 (admin) 执行正式激活' : '点击激活该策略'}
                              onClick={() => {
                                if (!confirming) {
                                  setConfirmActivateId(c.id);
                                  return;
                                }
                                setConfirmActivateId(null);
                                void executePolicyCmd('policy-activations', { id: c.id }, `激活策略 ${c.id}`);
                              }}
                              className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${
                                confirming ? 'bg-[#DC5353] hover:bg-red-700' : 'bg-[#159B76] hover:bg-emerald-700'
                              }`}
                            >
                              {confirming ? '再次点击确认正式激活' : `正式激活 (${c.approvals.length}/4)`}
                            </button>
                            {confirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmActivateId(null)}
                                className="cursor-pointer text-[11px] font-medium text-[#64748B] hover:text-[#172B3A]"
                              >
                                取消
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右：隔离回归报告与弱化/合规差异对比 */}
          <div className="card-surface p-5 lg:col-span-7">
            <SectionHeader
              title="隔离回归预演报告与授权差异明细"
              subtitle="对比弱化策略与合规策略在 Go 链码规则回归测试集下的真实拦截表现"
            />
            {data.previews.length === 0 ? (
              <EmptyState title="暂无策略预演报告" />
            ) : (
              <div className="space-y-4">
                {data.previews.map(prev => {
                  const open = expandedId === prev.id;
                  const window = prev.report.releaseWindow;
                  const reconstructable = window && window.before === data.currentPolicy.releaseSeconds &&
                    prev.report.changedFields.every(k => k === 'version' || k === 'releaseSeconds');
                  const draft = Number(prev.baseVersion) === data.currentPolicy.version
                    ? candidateDrafts[prev.id] ?? (reconstructable ? {id:prev.id,testsHash:prev.testsHash,
                        policy:{...data.currentPolicy,version:prev.report.candidateVersion,releaseSeconds:window.after}} : null) : null;
                  return (
                    <div key={prev.id} className="subtle-surface p-4 text-xs">
                      <div
                        onClick={() => setExpandedId(open ? null : prev.id)}
                        className="flex cursor-pointer flex-wrap items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          {prev.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-[#159B76]" />
                          ) : (
                            <XCircle className="h-4 w-4 text-[#DC5353]" />
                          )}
                          <span className="mono font-bold text-[#10243A]">{prev.id}</span>
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              prev.passed ? 'bg-[#159B76]/15 text-[#159B76]' : 'bg-[#DC5353]/12 text-[#DC5353]'
                            }`}
                          >
                            {prev.passed ? '回归通过' : '回归未通过 · 阻止发布'}
                          </span>
                        </div>
                        <span className="mono text-[11px] text-[#64748B]">
                          v{prev.baseVersion} → v{prev.report.candidateVersion}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2.5 rounded-lg border border-[#dce4ee] bg-white p-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[10px] text-[#64748B]">变更前必需组织</div>
                          <div className="mono mt-0.5 font-semibold text-[#172B3A]">
                            {prev.report.authorizationDifference.before.join(' + ')}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#64748B]">变更后必需组织</div>
                          <div className={`mono mt-0.5 font-bold ${prev.passed ? 'text-[#159B76]' : 'text-[#DC5353]'}`}>
                            {prev.report.authorizationDifference.after.join(' + ')}
                          </div>
                        </div>
                      </div>

                      {window && <p className="mt-2 text-xs">放行窗口 {window.before} 秒 → {window.after} 秒</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <HashChip value={prev.testsHash} label="回归证据哈希" />
                        {prev.report.ruleProof && (
                          <HashChip value={prev.report.ruleProof.ruleSourceHash} label="部署源码核验" />
                        )}
                        {prev.passed && draft && !data.candidates.some(c => c.id === prev.id) && (
                          <button
                            type="button"
                            disabled={busy || actor?.role !== 'admin'}
                            onClick={() =>
                              void executePolicyCmd(
                                'policy-candidates',
                                draft,
                                `提交候选策略 ${prev.id}`,
                              )
                            }
                            className="rounded-md bg-[#2563EB] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            提交为链上候选提案 (需 admin)
                          </button>
                        )}
                        <span className="mono ml-auto text-[10px] text-[#64748B]">{formatDateTime(prev.createdAt)}</span>
                      </div>

                      {open && prev.report.tests?.length > 0 && (
                        <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-[#dce4ee] bg-white p-3">
                          <div className="mb-2 text-[10px] font-bold text-[#64748B] uppercase">
                            隔离 Go 单元测试执行明细（{prev.report.tests.length} 项）
                          </div>
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {prev.report.tests.map(t => (
                              <div key={t.name} className="mono flex items-center justify-between rounded bg-[#F4F7FA] px-2.5 py-1 text-[10px]">
                                <span className="truncate pr-2 text-[#172B3A]">{t.name}</span>
                                <span className={`font-bold ${t.result === 'pass' ? 'text-[#159B76]' : 'text-[#DC5353]'}`}>
                                  {t.result.toUpperCase()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
