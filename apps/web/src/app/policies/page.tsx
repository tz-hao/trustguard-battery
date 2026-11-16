'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
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
  const { actor, switchActor } = useIdentity();
  const [data, setData] = useState<PoliciesPayload | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [candidateDrafts, setCandidateDrafts] = useState<
    Record<string, { id: string; policy: PolicyData; testsHash: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<CommandResultState | null>(null);

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
    if (!data?.currentPolicy) return;
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
              releaseSeconds: Math.min(7200, data.currentPolicy.releaseSeconds + 60),
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
            ? `隔离 Go 回归通过：合规候选策略 v${candidatePolicy.version} 未引入越权放行路径`
            : `隔离 Go 回归拦截：弱化策略（单方 PackOrgMSP 审批）导致安全回归失败，已阻止提交上链`,
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
        code="08 · SECURITY POLICY GOVERNANCE"
        title="安全策略变更预演与多组织治理中心"
        subtitle="管理员无法直接放宽放行底线；任何策略变更必须经过「候选版本 → 隔离 Go 链码回归 → 差异报告 → 多组织审批 → 激活」"
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

      {/* 5 步策略治理流程条 */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {[
            '01. 提出候选策略',
            '02. 隔离 Go 链码回归测试',
            '03. 生成授权差异与证据哈希',
            '04. 四组织独立批准',
            '05. 受控激活新版本',
          ].map((step, i) => (
            <React.Fragment key={step}>
              <div className="subtle-surface px-3 py-2 font-bold text-[#172B3A]">{step}</div>
              {i < 4 && <ArrowRight className="hidden h-4 w-4 text-[#94A3B8] md:block" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {banner && <TxResultBanner result={banner} onClose={() => setBanner(null)} />}

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
                    disabled={busy}
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
                title="策略候选提案、四组织审批与激活"
                subtitle="完整闭环：admin 提案 → 四组织 auditor 会签 → admin 激活（缺一不可）"
              />
              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-[#64748B]">快速切审计员：</span>
                {['cell-auditor', 'pack-auditor', 'lab-auditor', 'recycle-auditor'].map(aud => (
                  <button
                    key={aud}
                    type="button"
                    onClick={() => void switchActor(aud)}
                    className={`mono rounded border px-2 py-0.5 font-medium ${
                      actor?.name === aud
                        ? 'border-[#2563EB] bg-[#2563EB]/12 text-[#2563EB]'
                        : 'border-[#dce4ee] bg-[#F4F7FA] text-[#172B3A] hover:border-[#2563EB]'
                    }`}
                  >
                    {aud}
                  </button>
                ))}
              </div>
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
                      {c.state !== 'ACTIVE' && (
                        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-[#dce4ee] pt-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void executePolicyCmd('policy-approvals', { id: c.id }, `批准候选 ${c.id}`)}
                            className="rounded-md bg-[#10243A] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#17324f] disabled:opacity-50"
                          >
                            审计员批准 ({actor?.role === 'auditor' ? actor.mspId : '需 auditor'})
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void executePolicyCmd('policy-activations', { id: c.id }, `激活策略 ${c.id}`)}
                            className="rounded-md bg-[#159B76] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            正式激活 (需四方全签)
                          </button>
                        </div>
                      )}
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
                            {prev.passed ? '回归通过 · 可提议' : '越权风险 · 阻止发布'}
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

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <HashChip value={prev.testsHash} label="回归证据哈希" />
                        {prev.report.ruleProof && (
                          <HashChip value={prev.report.ruleProof.ruleSourceHash} label="部署源码核验" />
                        )}
                        {prev.passed && candidateDrafts[prev.id] && !data.candidates.some(c => c.id === prev.id) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void executePolicyCmd(
                                'policy-candidates',
                                candidateDrafts[prev.id],
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
