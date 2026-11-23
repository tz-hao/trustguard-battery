'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Cpu,
  Network,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { EmptyState, HashChip, PageBanner, SectionHeader } from '@/components/Badges';
import { RiskScorePanel } from '@/components/DataCharts';
import { formatDateTime } from '@/lib/types';

interface RiskPayload {
  riskReady: boolean;
  measurements: {
    asset_id: string;
    batch_id: string;
    chemistry: string;
    capacity_mah: number;
    resistance_uohm: number;
    voltage_mv: number;
    temperature_c: number;
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
  }[];
  riskResults: {
    id: string;
    requestId: string;
    assetId: string;
    policyVersion: string;
    modelVersion?: string;
    level?: string;
    quality_review_required?: boolean;
    operation_review_required?: boolean;
    evidenceHash?: string;
    signature?: string;
    expiresAt?: string;
    createdAt: string;
  }[];
  batches: { id: string; cellCount: number; cells: { id: string; quality: string }[] }[];
  assets: { id: string; quality: string; state: string }[];
  evaluation: {
    simulation: boolean;
    modelVersion: string;
    trainingSamples: number;
    testSamples: number;
    batchOverlap: number;
    model: { precision: number; recall: number; f1: number; falsePositiveRate: number; tp: number; fp: number; tn: number; fn: number };
    ruleBaseline: { precision: number; recall: number; f1: number; falsePositiveRate: number };
    latencyP95Ms: number;
    limitations: string;
  } | null;
  ablation?: {
    summary: {
      totalScenariosTested: number;
      baselineA_blocked: number;
      baselineB_blocked: number;
      experimentC_blocked: number;
      baselineA_protectionRate: number;
      baselineB_protectionRate: number;
      experimentC_protectionRate: number;
      avgQueryLatencyBaselineB_Ms: number;
      avgQueryLatencyWithRiskReadiness_Ms: number;
      addedRiskOverheadMs: number;
      aiQualityTestSetFPR: number;
      aiQualityTestSetRecall: number;
      ruleBaselineRecall: number;
    };
    cases: {
      id: string;
      name: string;
      category: string;
      baselineA_SingleDb: { blocked: boolean; note?: string };
      baselineB_FabricNoAi: { blocked: boolean; mechanism?: string; note?: string };
      experimentC_FullTrustGuard: { blocked: boolean; mechanism?: string };
    }[];
  } | null;
  concurrency?: {
    rateLimitThresholdPerActorMinute: number;
    rateLimitBurstProof: { totalRequests: number; ok: number; rateLimited429: number };
    targets: {
      name: string;
      path: string;
      desc: string;
      stages: { concurrency: number; rps: number; p50Ms: number; p95Ms: number; ok: number; totalRequests: number }[];
    }[];
  } | null;
}

interface OperationGraphResult {
  scenario: 'normal' | 'collusion';
  asOf: string;
  operations: {
    actor_msp: string;
    target_msp: string | null;
    action: string;
    approval_latency_seconds?: number | null;
  }[];
  analysis: {
    reviewRequired: boolean;
    triggeredRules: { rule: string; [key: string]: unknown }[];
    modelVersion: string;
    conclusion: string;
  };
}

interface AttackResult {
  id: string;
  title: string;
  blocked: boolean;
  stateUnchanged: boolean;
  beforeDigest: string;
  afterDigest: string;
  responseSummary: { httpStatus: number; stage: string; errorCode: string; rawBody: unknown };
  telemetry?: { timeline: { step: string; status: string; detail: string }[] };
}

export default function RiskPage() {
  const [data, setData] = useState<RiskPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoResult, setDemoResult] = useState<AttackResult | null>(null);
  const [opLoading, setOpLoading] = useState(false);
  const [opResult, setOpResult] = useState<OperationGraphResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bff/risk', { cache: 'no-store' });
      if (res.ok) setData((await res.json()) as RiskPayload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runActiveBlockDemo() {
    setDemoRunning(true);
    try {
      const res = await fetch('/api/bff/lab/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attackId: 'A2' }),
      });
      const json = await res.json();
      if (res.ok && json.results?.[0]) {
        setDemoResult(json.results[0] as AttackResult);
      }
    } finally {
      setDemoRunning(false);
    }
  }

  async function runOperationGraphDemo(scenario: 'normal' | 'collusion') {
    setOpLoading(true);
    try {
      const res = await fetch('/api/bff/risk/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      if (res.ok) {
        setOpResult((await res.json()) as OperationGraphResult);
      }
    } finally {
      setOpLoading(false);
    }
  }

  const flaggedMeasurements = (data?.measurements ?? []).filter(m => m.analysis?.reviewRequired);
  const riskAssetsCount = (data?.assets ?? []).filter(a => a.quality === 'QC_REJECTED' || a.quality === 'REVIEW_REQUIRED').length;
  const abnormalBatchesCount = (data?.batches ?? []).filter(b =>
    b.cells.some(c => c.quality === 'QC_REJECTED' || c.quality === 'REVIEW_REQUIRED'),
  ).length;
  const highRiskCount = (data?.riskResults ?? []).filter(r => r.level === 'HIGH' || r.quality_review_required).length;

  return (
    <div className="space-y-6">
      <PageBanner
        title="AI 质量与操作双轨风险分析中心"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#17324f]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新风控态势
            </button>
          </div>
        }
      />

      {/* 综合双轨风险评分仪表盘与因子贡献度 */}
      {data && (() => {
        const totalAssetsN = Math.max(1, data.assets.length);
        const totalMsN = Math.max(1, data.measurements.length);
        const totalRelN = Math.max(1, data.riskResults.length);
        const qualityRatio = Math.round((riskAssetsCount / totalAssetsN) * 100);
        const outlierRatio = Math.round((flaggedMeasurements.length / totalMsN) * 100);
        const highRiskRatio = Math.round((highRiskCount / totalRelN) * 100);
        const opRiskRatio = opResult?.analysis.reviewRequired ? 85 : 15;
        const compositeScore = Math.min(
          100,
          Math.round(qualityRatio * 0.35 + outlierRatio * 0.3 + highRiskRatio * 0.2 + opRiskRatio * 0.15),
        );
        const levelLabel = compositeScore >= 65 ? '高风险预警' : compositeScore >= 35 ? '中度需复核' : '低风险可控';
        return (
          <RiskScorePanel
            score={compositeScore}
            levelLabel={levelLabel}
            factors={[
              { label: '不合格 / 待复核资产占比', value: qualityRatio, tone: 'danger' },
              { label: '量测离群点预警比例', value: outlierRatio, tone: 'warning' },
              { label: '高风险放行凭证比例', value: highRiskRatio, tone: 'brand' },
              { label: '跨组织互批闭环操作风险', value: opRiskRatio, tone: 'teal' },
            ]}
          />
        );
      })()}

      {/* 风险总览 5 项指标 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">风险 / 复核资产</div>
          <div className="mono mt-1 text-2xl font-bold text-[#DC5353]">{riskAssetsCount}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">异常关联批次</div>
          <div className="mono mt-1 text-2xl font-bold text-[#D99A2B]">{abnormalBatchesCount}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">高风险放行凭证</div>
          <div className="mono mt-1 text-2xl font-bold text-[#10243A]">{highRiskCount}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">测量异常预警点</div>
          <div className="mono mt-1 text-2xl font-bold text-[#2563EB]">{flaggedMeasurements.length}</div>
        </div>
        <div className="card-surface p-4">
          <div className="text-[11px] text-[#64748B]">推理 P95 时延</div>
          <div className="mono mt-1 text-2xl font-bold text-[#159B76]">
            {data?.evaluation ? `${data.evaluation.latencyP95Ms.toFixed(2)} ms` : '—'}
          </div>
        </div>
      </div>

      {/* 三大 AI 与关系图引擎面板 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card-surface p-5">
          <SectionHeader
            title="1. Isolation Forest 离群检测"
            icon={<Cpu className="h-4 w-4 text-[#2563EB]" />}
          />
          {data?.evaluation ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="subtle-surface p-2.5">
                  <div className="text-[10px] text-[#64748B]">Precision / Recall</div>
                  <div className="mono font-bold text-[#172B3A]">
                    {(data.evaluation.model.precision * 100).toFixed(1)}% / {(data.evaluation.model.recall * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="subtle-surface p-2.5">
                  <div className="text-[10px] text-[#64748B]">F1 / 误报率</div>
                  <div className="mono font-bold text-[#172B3A]">
                    {(data.evaluation.model.f1 * 100).toFixed(1)}% / {(data.evaluation.model.falsePositiveRate * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-[#64748B]">
                训练样本 {data.evaluation.trainingSamples} · 测试样本 {data.evaluation.testSamples}
              </div>
            </div>
          ) : (
            <EmptyState title="暂无评估数据" />
          )}
        </div>

        <div className="card-surface p-5">
          <SectionHeader
            title="2. 确定性工程规则引擎"
            icon={<Activity className="h-4 w-4 text-[#0F9D8A]" />}
          />
          <div className="space-y-2 text-xs">
            <div className="subtle-surface p-2.5">
              <div className="font-bold text-[#172B3A]">电压阈值校验</div>
              <div className="text-[11px] text-[#64748B]">LFP 限定 2000–4000 mV；三元限定 2500–4500 mV</div>
            </div>
            <div className="subtle-surface p-2.5">
              <div className="font-bold text-[#172B3A]">测试温度范围校验</div>
              <div className="text-[11px] text-[#64748B]">标准测试参考温度区间 15℃ – 35℃</div>
            </div>
          </div>
        </div>

        <div className="card-surface p-5">
          <SectionHeader
            title="3. 跨机构协作风险识别"
            icon={<Network className="h-4 w-4 text-[#D99A2B]" />}
          />
          <div className="space-y-2 text-xs text-[#64748B]">
            <div className="subtle-surface p-2.5">
              <div className="font-bold text-[#172B3A]">极速互批簇与审批闭环</div>
              <div className="text-[11px]">5 分钟滑窗内检测 &lt;5s 异常快速互批与环路</div>
            </div>
            <div className="subtle-surface p-2.5">
              <div className="font-bold text-[#172B3A]">质检结论反复变更</div>
              <div className="text-[11px]">识别高频拒签率与质检结论反复反转</div>
            </div>
          </div>
        </div>
      </div>

      {/* 场景 B：异常检测 → 风险凭证 → 放行请求 → 链码拒绝 实测交互演示 */}
      <div className="navy-control-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3a5c] pb-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <ShieldAlert className="h-4 w-4 text-[#DC5353]" />
              场景 B · 异常电芯主动拦截实测闭环（真实调用后端 API 与 Go 链码）
            </h2>
            <p className="mt-0.5 text-xs text-slate-300">
              点击执行：对包含 QC_REJECTED 异常电芯的 PACK 发起真实放行请求 → 服务端签发风险凭证 → Go 链码执行 QUALITY_GATE 硬阻断
            </p>
          </div>
          <button
            type="button"
            disabled={demoRunning}
            onClick={() => void runActiveBlockDemo()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#DC5353] px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" />
            {demoRunning ? '正在执行链码拦截实测...' : '立即实测异常电芯放行阻断'}
          </button>
        </div>

        {demoResult ? (
          <div className="mt-4 space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-5">
              {(demoResult.telemetry?.timeline ?? []).map((st, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${
                    st.status === 'blocked'
                      ? 'border-[#DC5353] bg-[#DC5353]/20 text-red-100'
                      : st.status === 'pass'
                        ? 'border-[#159B76]/50 bg-[#159B76]/15 text-emerald-100'
                        : 'border-[#1e3a5c] bg-[#10243A] text-slate-400'
                  }`}
                >
                  <div className="font-bold">{st.step}</div>
                  <div className="mt-1 text-[11px] opacity-90">{st.detail}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="navy-subcard p-3.5">
                <div className="font-bold text-white">真实返回结论</div>
                <div className="mono mt-1.5 text-red-300">
                  HTTP {demoResult.responseSummary.httpStatus} · stage={demoResult.responseSummary.stage} · errorCode=
                  {demoResult.responseSummary.errorCode}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <HashChip value={demoResult.beforeDigest} label="Before" dark />
                  <HashChip value={demoResult.afterDigest} label="After" dark />
                </div>
              </div>
              <pre className="mono max-h-36 overflow-auto rounded-lg border border-[#1e3a5c] bg-[#07111f] p-3 text-[11px] text-red-200">
                {JSON.stringify(demoResult.responseSummary.rawBody, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-[#1e3a5c] py-6 text-center text-xs text-slate-400">
            点击右上角红色按钮，即可现场演示真实异常电芯如何被 AI 风控与 Fabric 链码共同拦截。
          </div>
        )}
      </div>

      {/* NetworkX 多组织协作关系图实时检测演示 */}
      <div className="card-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#edf2f7] pb-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-[#172B3A]">
              <Network className="h-4 w-4 text-[#2563EB]" />
              跨组织审批关系图风险分析
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={opLoading}
              onClick={() => void runOperationGraphDemo('normal')}
              className="rounded-lg border border-[#159B76]/40 bg-[#159B76]/10 px-3 py-1.5 text-xs font-semibold text-[#159B76] hover:bg-[#159B76]/15 disabled:opacity-50"
            >
              模拟正常协同审批
            </button>
            <button
              type="button"
              disabled={opLoading}
              onClick={() => void runOperationGraphDemo('collusion')}
              className="rounded-lg bg-[#D99A2B] px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {opLoading ? 'NetworkX 图分析中...' : '注入跨机构极速互批闭环'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="trace-dark-grid rounded-xl border border-[#1c3554] p-3 lg:col-span-6">
            <svg viewBox="0 0 420 220" className="h-52 w-full">
              <defs>
                <marker id="risk-arr-ok" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill="#0F9D8A" />
                </marker>
                <marker id="risk-arr-bad" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill="#DC5353" />
                </marker>
              </defs>
              {(() => {
                const coords: Record<string, { x: number; y: number; short: string }> = {
                  CellOrgMSP: { x: 95, y: 60, short: 'CellOrg' },
                  PackOrgMSP: { x: 325, y: 60, short: 'PackOrg' },
                  LabOrgMSP: { x: 95, y: 165, short: 'LabOrg' },
                  RecycleOrgMSP: { x: 325, y: 165, short: 'RecycleOrg' },
                };
                const ops = (opResult?.operations ?? []).filter(o => o.target_msp && coords[o.actor_msp] && coords[o.target_msp]);
                const uniqueEdges = new Map<string, { from: string; to: string; count: number; fast: boolean }>();
                for (const o of ops) {
                  const key = `${o.actor_msp}->${o.target_msp}`;
                  const prev = uniqueEdges.get(key) ?? {
                    from: o.actor_msp,
                    to: o.target_msp!,
                    count: 0,
                    fast: false,
                  };
                  prev.count += 1;
                  if ((o.approval_latency_seconds ?? 99) < 5) prev.fast = true;
                  uniqueEdges.set(key, prev);
                }
                const isCycle = opResult?.scenario === 'collusion';
                return (
                  <>
                    {[...uniqueEdges.values()].map(edge => {
                      const p1 = coords[edge.from];
                      const p2 = coords[edge.to];
                      const reverseExists = uniqueEdges.has(`${edge.to}->${edge.from}`);
                      const dy = reverseExists && edge.from > edge.to ? 14 : reverseExists ? -14 : 0;
                      const stroke = isCycle && edge.fast ? '#DC5353' : '#0F9D8A';
                      return (
                        <g key={`${edge.from}-${edge.to}`}>
                          <path
                            d={`M ${p1.x} ${p1.y + dy * 0.5} Q ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2 + dy * 2} ${p2.x} ${p2.y + dy * 0.5}`}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={edge.fast ? 2.4 : 1.6}
                            strokeDasharray={edge.fast ? '5 3' : undefined}
                            markerEnd={edge.fast ? 'url(#risk-arr-bad)' : 'url(#risk-arr-ok)'}
                          />
                          <text
                            x={(p1.x + p2.x) / 2}
                            y={(p1.y + p2.y) / 2 + dy * 1.4 - 4}
                            fontSize="9"
                            fontWeight="700"
                            fill={stroke}
                            textAnchor="middle"
                          >
                            ×{edge.count} {edge.fast ? '(<5s)' : ''}
                          </text>
                        </g>
                      );
                    })}
                    {Object.entries(coords).map(([msp, pos]) => (
                      <g key={msp}>
                        <rect
                          x={pos.x - 54}
                          y={pos.y - 20}
                          width="108"
                          height="40"
                          rx="8"
                          fill="#10243A"
                          stroke={isCycle && (msp === 'CellOrgMSP' || msp === 'PackOrgMSP') ? '#DC5353' : '#3185D8'}
                          strokeWidth="1.6"
                        />
                        <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
                          {pos.short}
                        </text>
                      </g>
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>

          <div className="space-y-3 text-xs lg:col-span-6">
            {!opResult ? (
              <EmptyState title="尚未执行协作图推演" subtitle="点击右上角按钮分析跨机构审批序列" />
            ) : (
              <>
                <div
                  className={`rounded-xl border p-3.5 ${
                    opResult.analysis.reviewRequired
                      ? 'border-[#DC5353]/35 bg-[#DC5353]/8 text-[#8f2323]'
                      : 'border-[#159B76]/35 bg-[#159B76]/8 text-[#0c5e47]'
                  }`}
                >
                  <div className="font-bold">
                    NetworkX 判定：{opResult.analysis.conclusion}
                  </div>
                  <div className="mt-1 text-[11px]">
                    {opResult.analysis.reviewRequired
                      ? '检测到极速互批簇或强连通环，强制提升至独立机构复核'
                      : '审批方向正常分散且无强连通环路'}
                  </div>
                </div>
                <pre className="mono max-h-36 overflow-auto rounded-lg bg-[#0B192C] p-3 text-[11px] text-slate-200">
                  {JSON.stringify(opResult.analysis, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 测量指标列表 & 已签发风险凭证 */}
      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="card-surface p-5 lg:col-span-6">
            <SectionHeader
              title="电芯检测特征与实时 AI 异常评分"
              subtitle="包含容量、内阻、异常分数与触发规则"
              action={
                <Link href="/inspections" className="text-xs font-semibold text-[#2563EB] hover:underline">
                  查看散点图 →
                </Link>
              }
            />
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1 text-xs">
              {data.measurements.slice(0, 15).map((m, idx) => (
                <div key={`${m.asset_id}-${idx}`} className="subtle-surface flex items-center justify-between gap-2 p-3">
                  <div>
                    <div className="mono font-bold text-[#172B3A]">{m.asset_id}</div>
                    <div className="mono text-[10px] text-[#64748B]">
                      {m.capacity_mah} mAh · {m.resistance_uohm} uΩ · {m.voltage_mv} mV · {m.temperature_c} ℃
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`mono rounded px-2 py-0.5 text-[10px] font-bold ${
                        m.analysis?.reviewRequired ? 'bg-[#D99A2B]/15 text-[#b07612]' : 'bg-[#159B76]/15 text-[#159B76]'
                      }`}
                    >
                      score {m.analysis?.anomalyScore !== null && m.analysis?.anomalyScore !== undefined ? m.analysis.anomalyScore.toFixed(3) : '—'}
                    </span>
                    <div className="mt-0.5 text-[10px] text-[#64748B]">{m.analysis?.modelVersion}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-5 lg:col-span-6">
            <SectionHeader
              title="已签发 Ed25519 风险凭证 (RiskAttestation)"
              subtitle="与放行请求、快照哈希和策略版本绑定，有效期受限"
              icon={<ShieldCheck className="h-4 w-4 text-[#159B76]" />}
            />
            {data.riskResults.length === 0 ? (
              <EmptyState title="暂无已签发风险凭证" />
            ) : (
              <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1 text-xs">
                {data.riskResults.map(r => (
                  <div key={r.id} className="subtle-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono font-bold text-[#172B3A]">{r.id}</span>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          r.level === 'HIGH' ? 'bg-[#DC5353]/12 text-[#DC5353]' : 'bg-[#159B76]/12 text-[#159B76]'
                        }`}
                      >
                        {r.level ?? 'NORMAL'} · 策略 v{r.policyVersion}
                      </span>
                    </div>
                    <div className="mono mt-1 text-[10px] text-[#64748B]">
                      资产: {r.assetId} · 模型: {r.modelVersion ?? 'risk-v1'}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <HashChip value={r.evidenceHash} label="证据摘要" />
                      <span className="mono text-[10px] text-[#64748B]">{formatDateTime(r.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
