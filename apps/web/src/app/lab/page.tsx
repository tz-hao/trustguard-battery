'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Layers,
  Lock,
  Play,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';
import { HashChip, OrgBadge, SectionHeader } from '@/components/Badges';
import { DefenseMatrixBoard } from '@/components/DataCharts';
import { ERROR_DESCRIPTIONS, ROLE_LABELS, formatDateTime } from '@/lib/types';

type AttackId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8';

interface AttackTelemetry {
  interceptionLayer: string;
  interceptionLabel: string;
  attackEntry: string;
  reachedFabric: boolean;
  endorsed: boolean;
  submitted: boolean;
  writtenToBlock: boolean;
  timeline: { step: string; status: 'pass' | 'blocked' | 'skipped'; detail: string }[];
}

interface AttackExecutionResult {
  id: AttackId;
  title: string;
  targetDescription: string;
  actorUsed: { name: string; mspId: string; role: string; fingerprintPrefix: string };
  requestSummary: { method: string; route: string; payloadPreview: Record<string, unknown> };
  responseSummary: { httpStatus: number; stage: string; errorCode: string; rawBody: unknown };
  blocked: boolean;
  stateUnchanged: boolean;
  beforeDigest: string;
  afterDigest: string;
  checkedAt: string;
  notes: string;
  telemetry: AttackTelemetry;
}

const PRESETS: {
  id: AttackId;
  title: string;
  summary: string;
  actor: string;
  defenseLayer: string;
  layerTag: 'peer' | 'chaincode' | 'api' | 'sandbox';
}[] = [
  {
    id: 'A1',
    title: 'A1 · 越权冒充检测员签发质检',
    summary: 'PACK 制造证书直接发起 SubmitInspection 提案',
    actor: 'pack-manufacturer',
    defenseLayer: 'Peer 背书身份校验',
    layerTag: 'peer',
  },
  {
    id: 'A2',
    title: 'A2 · 含不合格电芯强行申请放行',
    summary: '对包含 QC_REJECTED 电芯的电池包申请放行',
    actor: 'pack-release',
    defenseLayer: '链码 QUALITY_GATE 门禁',
    layerTag: 'chaincode',
  },
  {
    id: 'A3',
    title: 'A3 · 篡改检测报告正文保留原哈希',
    summary: '替换明文内容但沿用原签名与 plaintextHash',
    actor: 'lab-inspector',
    defenseLayer: '网关 SHA-256 完整性核验',
    layerTag: 'api',
  },
  {
    id: 'A4',
    title: 'A4 · 转出方单方伪造接收确认',
    summary: '转出方 PackOrg 试图自签 ConfirmTransfer',
    actor: 'pack-custodian',
    defenseLayer: '链码双签持有方约束',
    layerTag: 'chaincode',
  },
  {
    id: 'A5',
    title: 'A5 · 已报废电池违规回流普通交接',
    summary: '对 PROCESSED 终态电池发起普通转移',
    actor: 'recycle-custodian',
    defenseLayer: '终态不可回流状态机',
    layerTag: 'chaincode',
  },
  {
    id: 'A6',
    title: 'A6 · 发布弱化多方审批门槛策略',
    summary: '企图将 requiredOrgs 缩减为仅 PackOrgMSP',
    actor: 'cell-admin',
    defenseLayer: '策略沙箱回归预演拦截',
    layerTag: 'sandbox',
  },
  {
    id: 'A7',
    title: 'A7 · 非法 23/25 位与错误材料码',
    summary: '提交越长、不足长及非法材料位 I 的编码',
    actor: 'cell-viewer',
    defenseLayer: 'GB/T 34014 链码解析器',
    layerTag: 'chaincode',
  },
  {
    id: 'A8',
    title: 'A8 · 非授权企业篡改报废确认事件',
    summary: '电芯制造方对在用 PACK 提交 scrap-confirmations',
    actor: 'cell-manufacturer',
    defenseLayer: 'Peer/链码 MSP 角色约束',
    layerTag: 'peer',
  },
];

const LAYER_BADGE: Record<string, string> = {
  peer: 'bg-[#2563EB]/20 text-blue-200 border-[#2563EB]/40',
  chaincode: 'bg-[#0F9D8A]/20 text-teal-200 border-[#0F9D8A]/40',
  api: 'bg-[#D99A2B]/20 text-amber-200 border-[#D99A2B]/40',
  sandbox: 'bg-[#3185D8]/20 text-sky-200 border-[#3185D8]/40',
};

export default function LabPage() {
  const [results, setResults] = useState<Partial<Record<AttackId, AttackExecutionResult>>>({});
  const [selectedId, setSelectedId] = useState<AttackId>('A1');
  const [running, setRunning] = useState<AttackId | 'ALL' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function execute(attackId: AttackId | 'ALL') {
    setRunning(attackId);
    setError(null);
    try {
      const res = await fetch('/api/bff/lab/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attackId }),
      });
      const json = (await res.json()) as { results?: AttackExecutionResult[]; message?: string };
      if (!res.ok) {
        setError(json.message ?? '攻防脚本执行失败');
        return;
      }
      const next = { ...results };
      for (const item of json.results ?? []) {
        next[item.id] = item;
      }
      setResults(next);
      if (attackId !== 'ALL') setSelectedId(attackId);
    } finally {
      setRunning(null);
    }
  }

  const executedList = Object.values(results).filter((r): r is AttackExecutionResult => Boolean(r));
  const blockedCount = executedList.filter(r => r.blocked).length;
  const unchangedCount = executedList.filter(r => r.stateUnchanged).length;
  const activePreset = PRESETS.find(p => p.id === selectedId) ?? PRESETS[0];
  const activeResult = results[selectedId];

  return (
    <div className="space-y-5">
      {/* Deep Navy Security Control Header */}
      <div className="navy-control-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1e3a5c] pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">区块链安全攻防实验室</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void execute(selectedId)}
              disabled={running !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#3185D8]/50 bg-[#17324f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1e3e61] disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 text-[#0F9D8A]" />
              {running === selectedId ? `正在执行 ${selectedId}...` : `运行 ${selectedId}`}
            </button>
            <button
              type="button"
              onClick={() => void execute('ALL')}
              disabled={running !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC5353] px-4 py-2 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {running === 'ALL' ? 'A1–A8 实网执行中...' : '一键运行 A1–A8 全量压测'}
            </button>
          </div>
        </div>

        {/* 4 Summary Metrics */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="navy-subcard p-3.5">
            <div className="text-[11px] text-slate-400">实网攻防矩阵覆盖</div>
            <div className="mono mt-1 text-2xl font-bold text-white">8 场景</div>
            <div className="mt-1 text-[11px] text-slate-300">已触发验证 {executedList.length} / 8 项</div>
          </div>
          <div className="navy-subcard p-3.5">
            <div className="text-[11px] text-slate-400">实网攻击拦截率</div>
            <div className="mono mt-1 text-2xl font-bold text-[#159B76]">
              {executedList.length > 0 ? `${blockedCount} / ${executedList.length}` : '待运行'}
            </div>
            <div className="mt-1 text-[11px] text-slate-300">全部违规请求应被明确阻断</div>
          </div>
          <div className="navy-subcard p-3.5">
            <div className="text-[11px] text-slate-400">账本摘要零篡改验证</div>
            <div className="mono mt-1 text-2xl font-bold text-[#3185D8]">
              {executedList.length > 0 ? `${unchangedCount} / ${executedList.length}` : '待运行'}
            </div>
            <div className="mt-1 text-[11px] text-slate-300">beforeDigest === afterDigest</div>
          </div>
          <div className="navy-subcard p-3.5">
            <div className="text-[11px] text-slate-400">当前选中防御焦点</div>
            <div className="mt-1 truncate text-sm font-bold text-amber-200">{activePreset.defenseLayer}</div>
            <div className="mono mt-1 truncate text-[11px] text-slate-300">攻击身份: {activePreset.actor}</div>
          </div>
        </div>

        {/* Active Defense Matrix Scoreboard (A1-A8) */}
        <DefenseMatrixBoard
          presets={PRESETS}
          results={results}
          selectedId={selectedId}
          onSelect={id => setSelectedId(id as AttackId)}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-[#DC5353]/40 bg-[#DC5353]/10 p-3 text-xs font-semibold text-[#8f2323]">
          {error}
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* Left: A1-A8 Scenario Deck */}
        <div className="navy-control-panel p-4 lg:col-span-4">
          <SectionHeader
            title="A1–A8 攻击场景控制台"
            subtitle="点击选择场景，可单点实时复现或查看全量结果"
            icon={<ShieldAlert className="h-4 w-4 text-[#DC5353]" />}
            dark
          />
          <div className="space-y-2.5">
            {PRESETS.map(p => {
              const res = results[p.id];
              const isSelected = p.id === selectedId;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    isSelected
                      ? 'border-[#3185D8] bg-[#17324f]'
                      : 'border-[#1e3a5c] bg-[#10243A] hover:border-[#3185D8]/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mono rounded bg-[#0b192c] px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {p.id}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${LAYER_BADGE[p.layerTag]}`}>
                          {p.defenseLayer}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs font-bold text-white">{p.title.replace(`${p.id} · `, '')}</div>
                      <div className="mt-0.5 text-[11px] text-slate-300">{p.summary}</div>
                    </div>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        void execute(p.id);
                      }}
                      disabled={running !== null}
                      className="shrink-0 rounded-md bg-[#2563EB] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-45"
                    >
                      {running === p.id ? '执行中' : '攻击'}
                    </button>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-[#1e3a5c] pt-2 text-[10px]">
                    <span className="mono text-slate-300">凭证: {p.actor}</span>
                    {res ? (
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          res.blocked && res.stateUnchanged ? 'text-[#20c997]' : 'text-[#ff7b7b]'
                        }`}
                      >
                        {res.blocked ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {res.blocked ? `HTTP ${res.responseSummary.httpStatus} · 拦截成功` : '未拦截'}
                      </span>
                    ) : (
                      <span className="text-slate-300/80">待触发</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1e3a5c] pt-3 text-[11px]">
            <Link
              href="/risk"
              className="inline-flex items-center gap-1 rounded-md border border-[#1e3a5c] bg-[#0b192c] px-2.5 py-1 text-slate-200 hover:border-[#0F9D8A]"
            >
              AI 风险联防 (A2)
              <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              href="/policies"
              className="inline-flex items-center gap-1 rounded-md border border-[#1e3a5c] bg-[#0b192c] px-2.5 py-1 text-slate-200 hover:border-[#3185D8]"
            >
              策略预演拦截 (A6)
              <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              href="/audit"
              className="inline-flex items-center gap-1 rounded-md border border-[#1e3a5c] bg-[#0b192c] px-2.5 py-1 text-slate-200 hover:border-[#2563EB]"
            >
              查看链上审计证据
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Right: Deep Telemetry Inspector */}
        <div className="space-y-4 lg:col-span-8 lg:sticky lg:top-20">
          {!activeResult ? (
            <div className="navy-control-panel flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1e3a5c] bg-[#10243A]">
                <Terminal className="h-7 w-7 text-[#3185D8]" />
              </div>
              <h3 className="text-base font-bold text-white">{activePreset.title}</h3>
              <p className="mt-1.5 max-w-md text-xs text-slate-300">{activePreset.summary}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-300">
                <span className="rounded border border-[#1e3a5c] bg-[#10243A] px-2.5 py-1">
                  目标防线: {activePreset.defenseLayer}
                </span>
                <span className="mono rounded border border-[#1e3a5c] bg-[#10243A] px-2.5 py-1">
                  发起证书: {activePreset.actor}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void execute(selectedId)}
                disabled={running !== null}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                立即对该防御层发起实网对抗请求
              </button>
            </div>
          ) : (
            <>
              {/* Outcome & Actor Card */}
              <div className="navy-control-panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1e3a5c] pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-bold ${
                          activeResult.blocked && activeResult.stateUnchanged
                            ? 'border-[#159B76]/50 bg-[#159B76]/20 text-emerald-200'
                            : 'border-[#DC5353]/50 bg-[#DC5353]/20 text-rose-200'
                        }`}
                      >
                        {activeResult.blocked ? <ShieldCheck className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                        {activeResult.blocked ? 'ATTACK BLOCKED · 拦截生效' : '未阻断'}
                      </span>
                      <span className="rounded border border-[#3185D8]/40 bg-[#3185D8]/15 px-2.5 py-0.5 text-xs font-semibold text-sky-200">
                        拦截层: {activeResult.telemetry.interceptionLabel}
                      </span>
                    </div>
                    <h2 className="mt-2 text-base font-bold text-white">{activeResult.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-300">{activeResult.targetDescription}</p>
                  </div>
                  <div className="navy-subcard px-3.5 py-2.5 text-right text-xs">
                    <div className="text-[10px] text-slate-400">HTTP 响应 / 交易阶段 / 错误码</div>
                    <div className="mono mt-1 font-bold text-rose-300">
                      HTTP {activeResult.responseSummary.httpStatus} · {activeResult.responseSummary.stage} ·{' '}
                      {activeResult.responseSummary.errorCode}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{formatDateTime(activeResult.checkedAt)}</div>
                  </div>
                </div>

                {/* Error explanation banner */}
                {ERROR_DESCRIPTIONS[activeResult.responseSummary.errorCode] && (
                  <div className="mt-3 rounded-lg border border-[#D99A2B]/40 bg-[#D99A2B]/12 px-3.5 py-2 text-xs text-amber-100">
                    <strong>错误语义解析：</strong>
                    {ERROR_DESCRIPTIONS[activeResult.responseSummary.errorCode]}
                  </div>
                )}

                {/* Actor mTLS Metadata & Consensus Funnel */}
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="navy-subcard p-3.5 text-xs">
                    <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-200">
                      <KeyRound className="h-3.5 w-3.5 text-[#3185D8]" />
                      服务端注入的 mTLS 攻击者身份
                    </div>
                    <div className="space-y-1.5 text-slate-300">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">证书身份名称</span>
                        <span className="mono font-semibold text-white">{activeResult.actorUsed.name}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">所属组织 MSP</span>
                        <OrgBadge mspId={activeResult.actorUsed.mspId} dark />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">业务角色属性</span>
                        <span>
                          {ROLE_LABELS[activeResult.actorUsed.role] ?? activeResult.actorUsed.role} ({activeResult.actorUsed.role})
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">TLS 指纹前缀</span>
                        <span className="mono text-sky-300">{activeResult.actorUsed.fingerprintPrefix}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">攻击接入点</span>
                        <span className="mono text-[11px] text-amber-200">{activeResult.telemetry.attackEntry}</span>
                      </div>
                    </div>
                  </div>

                  {/* Fabric Consensus Isolation Proof */}
                  <div className="navy-subcard p-3.5 text-xs">
                    <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-200">
                      <Layers className="h-3.5 w-3.5 text-[#0F9D8A]" />
                      Hyperledger Fabric 提案生命周期阻断定位
                    </div>
                    <div className="grid grid-cols-4 gap-2 pt-1 text-center">
                      {[
                        { label: '到达 Fabric', ok: activeResult.telemetry.reachedFabric },
                        { label: 'Peer 背书', ok: activeResult.telemetry.endorsed },
                        { label: 'Orderer 排序', ok: activeResult.telemetry.submitted },
                        { label: '写块落盘', ok: activeResult.telemetry.writtenToBlock },
                      ].map(node => (
                        <div
                          key={node.label}
                          className={`rounded-lg border p-2 ${
                            node.ok
                              ? 'border-[#2563EB]/40 bg-[#2563EB]/15 text-blue-200'
                              : 'border-[#DC5353]/40 bg-[#0b192c] text-slate-400'
                          }`}
                        >
                          <div className="text-[10px]">{node.label}</div>
                          <div className={`mono mt-1 font-bold ${node.ok ? 'text-blue-200' : 'text-[#DC5353]'}`}>
                            {node.ok ? 'PASS' : 'NO'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-md border border-[#1e3a5c] bg-[#0b192c] px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Lock className="h-3 w-3 text-[#159B76]" />
                        链上状态摘要对比
                      </span>
                      <span className="mono font-bold text-[#159B76]">
                        {activeResult.stateUnchanged ? 'SHA-256 完全一致 · 零污染' : '摘要发生变化'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5-Step Execution Timeline */}
              <div className="card-surface p-5">
                <SectionHeader
                  title="5 步攻防执行遥测链路"
                  subtitle="精确记录状态基线采样、请求发起、防御层拦截判定与账本后置指纹核验"
                  icon={<Activity className="h-4 w-4 text-[#2563EB]" />}
                />
                <div className="space-y-2.5">
                  {activeResult.telemetry.timeline.map((t, idx) => (
                    <div
                      key={`${t.step}-${idx}`}
                      className={`flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs ${
                        t.status === 'blocked'
                          ? 'border-[#DC5353]/35 bg-[#DC5353]/5'
                          : t.status === 'pass'
                            ? 'border-[#159B76]/30 bg-[#159B76]/5'
                            : 'border-[#dce4ee] bg-[#F4F7FA]'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                            t.status === 'blocked'
                              ? 'bg-[#DC5353]'
                              : t.status === 'pass'
                                ? 'bg-[#159B76]'
                                : 'bg-[#94A3B8]'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-semibold text-[#172B3A]">{t.step}</div>
                          <div className="mt-0.5 text-[11px] text-[#64748B]">{t.detail}</div>
                        </div>
                      </div>
                      <span
                        className={`mono shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                          t.status === 'blocked'
                            ? 'bg-[#DC5353]/15 text-[#DC5353]'
                            : t.status === 'pass'
                              ? 'bg-[#159B76]/15 text-[#159B76]'
                              : 'bg-[#EDF2F7] text-[#64748B]'
                        }`}
                      >
                        {t.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Before/After Digest Comparison */}
                <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-[#dce4ee] bg-[#F4F7FA] p-3.5 text-xs sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-[#64748B]">攻击前目标状态 SHA-256 摘要</div>
                    <HashChip value={activeResult.beforeDigest} head={14} tail={12} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-[#64748B]">攻击后目标状态 SHA-256 摘要</div>
                    <HashChip value={activeResult.afterDigest} head={14} tail={12} />
                  </div>
                </div>
                <div className="mt-2.5 text-[11px] text-[#64748B]">{activeResult.notes}</div>
              </div>

              {/* Raw Request / Response Forensic Payloads */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="navy-control-panel p-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold text-white">攻击请求报文</span>
                    <span className="mono rounded bg-[#2563EB]/25 px-2 py-0.5 text-[10px] text-blue-200">
                      {activeResult.requestSummary.method} {activeResult.requestSummary.route}
                    </span>
                  </div>
                  <pre className="mono max-h-60 overflow-auto rounded-lg border border-[#1e3a5c] bg-[#060f1d] p-3 text-[11px] text-slate-200">
                    {JSON.stringify(activeResult.requestSummary.payloadPreview, null, 2)}
                  </pre>
                </div>
                <div className="navy-control-panel p-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold text-white">拦截响应原文（API / Fabric 返回）</span>
                    <span className="mono rounded bg-[#DC5353]/25 px-2 py-0.5 text-[10px] text-rose-200">
                      HTTP {activeResult.responseSummary.httpStatus}
                    </span>
                  </div>
                  <pre className="mono max-h-60 overflow-auto rounded-lg border border-[#1e3a5c] bg-[#060f1d] p-3 text-[11px] text-rose-200">
                    {JSON.stringify(activeResult.responseSummary.rawBody, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
