'use client';

import React, { useId } from 'react';
import { CheckCircle2, Clock, ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * P0: Semi-Circular SOH Health Gauge for Battery Identity Workbench
 */
export function SohGaugeCard({
  sohPct,
  allowed,
  cycleCount,
  measuredAt,
}: {
  sohPct: number | null | undefined;
  allowed: boolean;
  cycleCount?: number | null;
  measuredAt?: string | null;
}) {
  const gradId = useId();
  const hasVal = allowed && typeof sohPct === 'number' && Number.isFinite(sohPct);
  const clamped = hasVal ? Math.max(0, Math.min(100, sohPct)) : 0;
  const r = 46;
  const halfCirc = Math.PI * r;
  const filled = (clamped / 100) * halfCirc;
  const status = !hasVal
    ? { label: allowed ? '暂无快照' : '需授权', color: '#94a3b8', pill: 'bg-subtle text-ink-secondary' }
    : clamped >= 85
      ? { label: '健康优良', color: '#149672', pill: 'bg-success/12 text-success' }
      : clamped >= 70
        ? { label: '轻度衰减', color: '#d99422', pill: 'bg-warning/15 text-[#a86e0c]' }
        : { label: '建议梯次/退役', color: '#dc4c4c', pill: 'bg-danger/12 text-danger' };

  return (
    <div className="subtle-surface flex items-center justify-between gap-3 p-3.5">
      <div className="relative h-[74px] w-[124px] shrink-0">
        <svg viewBox="0 0 120 72" className="h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#dc4c4c" />
              <stop offset="50%" stopColor="#d99422" />
              <stop offset="100%" stopColor="#149672" />
            </linearGradient>
          </defs>
          <path
            d="M 14 60 A 46 46 0 0 1 106 60"
            fill="none"
            stroke="#dce4ee"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {hasVal && (
            <path
              d="M 14 60 A 46 46 0 0 1 106 60"
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${halfCirc}`}
            />
          )}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center">
          <div className="kpi-value text-lg font-bold text-ink">{hasVal ? `${clamped.toFixed(1)}%` : '—'}</div>
          <div className="text-[10px] font-medium text-ink-muted">SOH 健康度</div>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="font-bold text-ink">电池健康状态</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.pill}`}>{status.label}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-secondary">
          <span>循环次数</span>
          <span className="mono font-semibold text-ink">
            {allowed && typeof cycleCount === 'number' ? `${cycleCount} 次` : '—'}
          </span>
        </div>
        {measuredAt && allowed && (
          <div className="truncate text-[10.5px] text-ink-muted">最近采集：{measuredAt.slice(0, 16).replace('T', ' ')}</div>
        )}
      </div>
    </div>
  );
}

/**
 * P0: Service Age vs Design Life Ruler + 5-Stage Lifecycle Milestone Track
 */
export function ServiceLifeBar({
  serviceAge,
  designLifeMonths,
  state,
  manufacturedAt,
  installedAt,
  firstUseAt,
  retiredAt,
  scrapped,
}: {
  serviceAge: { years: number; months: number; days: number } | null;
  designLifeMonths: number | null;
  state: string;
  manufacturedAt?: string | null;
  installedAt?: string | null;
  firstUseAt?: string | null;
  retiredAt?: string | null;
  scrapped?: boolean;
}) {
  const usedMonths = serviceAge ? serviceAge.years * 12 + serviceAge.months + serviceAge.days / 30 : 0;
  const pct = designLifeMonths && designLifeMonths > 0 ? Math.min(100, Math.round((usedMonths / designLifeMonths) * 100)) : 0;

  const milestones = [
    { key: 'mfg', label: '制造', done: Boolean(manufacturedAt) },
    { key: 'inst', label: '装车', done: Boolean(installedAt) || ['INSTALLED', 'IN_USE', 'RETIRED', 'RECEIVED_FOR_RECYCLING', 'PROCESSED'].includes(state) },
    { key: 'use', label: '首用', done: Boolean(firstUseAt) || ['IN_USE', 'RETIRED', 'RECEIVED_FOR_RECYCLING', 'PROCESSED'].includes(state) },
    { key: 'ret', label: '退役', done: Boolean(retiredAt) || ['RETIRED', 'RECEIVED_FOR_RECYCLING', 'PROCESSED'].includes(state) },
    { key: 'scr', label: '报废', done: Boolean(scrapped) || state === 'PROCESSED' },
  ];

  return (
    <div className="subtle-surface space-y-3 p-3.5 text-xs">
      <div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-ink">服役进度 / 设计寿命</span>
          <span className="mono font-bold text-brand">
            {designLifeMonths ? `${(usedMonths / 12).toFixed(1)} / ${(designLifeMonths / 12).toFixed(1)} 年 (${pct}%)` : '未设定设计寿命'}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-line">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              pct >= 85
                ? 'bg-gradient-to-r from-warning to-danger'
                : 'bg-gradient-to-r from-brand to-teal'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="relative grid grid-cols-5 gap-1 pt-1">
        <div className="pointer-events-none absolute top-[13px] right-[10%] left-[10%] h-0.5 bg-line" />
        {milestones.map(m => (
          <div key={m.key} className="relative z-10 flex flex-col items-center gap-1 text-center">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold ${
                m.done
                  ? 'border-teal bg-teal text-white'
                  : 'border-line bg-white text-ink-muted'
              }`}
            >
              {m.done ? '✓' : ''}
            </span>
            <span className={`text-[10px] font-medium ${m.done ? 'text-ink' : 'text-ink-muted'}`}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * P0: Composite Risk Score Gauge + Weighted Risk Factor Bars for AI Risk Center
 */
export function RiskScorePanel({
  score,
  levelLabel,
  factors,
}: {
  score: number;
  levelLabel: string;
  factors: { label: string; value: number; tone: 'danger' | 'warning' | 'brand' | 'teal' }[];
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const r = 50;
  const halfCirc = Math.PI * r;
  const filled = (clamped / 100) * halfCirc;
  const stroke = clamped >= 65 ? '#f43f5e' : clamped >= 35 ? '#f59e0b' : '#14b8a6';

  const barTone = {
    danger: 'bg-gradient-to-r from-rose-500 to-red-400',
    warning: 'bg-gradient-to-r from-amber-500 to-yellow-400',
    brand: 'bg-gradient-to-r from-blue-500 to-sky-400',
    teal: 'bg-gradient-to-r from-teal-500 to-emerald-400',
  };

  return (
    <div className="navy-control-panel p-5">
      <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-12">
        <div className="flex flex-col items-center justify-center lg:col-span-4">
          <div className="relative h-[96px] w-[156px]">
            <svg viewBox="0 0 140 84" className="h-full w-full overflow-visible" aria-hidden="true">
              <path d="M 20 72 A 50 50 0 0 1 120 72" fill="none" stroke="#183252" strokeWidth="12" strokeLinecap="round" />
              <path
                d="M 20 72 A 50 50 0 0 1 120 72"
                fill="none"
                stroke={stroke}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${halfCirc}`}
              />
            </svg>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
              <div className="kpi-value text-3xl font-bold text-white">{clamped}</div>
              <div className="text-[11px] font-semibold" style={{ color: stroke }}>
                {levelLabel}
              </div>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">综合双轨风险指数（0–100）</div>
        </div>

        <div className="space-y-3 lg:col-span-8">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">多维度风险因子贡献度拆解</span>
            <span className="mono text-[11px] text-slate-400">实时基于质量与操作日志计算</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {factors.map(f => {
              const pct = Math.max(4, Math.min(100, Math.round(f.value)));
              return (
                <div key={f.label} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200">{f.label}</span>
                    <span className="mono font-bold text-white">{Math.round(f.value)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#061120] ring-1 ring-white/10">
                    <div className={`h-full rounded-full ${barTone[f.tone]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * P1: Bullet Range Chart for Single Cell Quality Measurements (/inspections)
 */
export function MeasurementBulletGrid({
  voltageMv,
  resistanceUohm,
  capacityMah,
  temperatureC,
}: {
  voltageMv: number;
  resistanceUohm: number;
  capacityMah: number;
  temperatureC: number;
}) {
  const specs = [
    { label: '开路电压', unit: 'mV', value: voltageMv, min: 2800, max: 4350, safeLow: 3150, safeHigh: 4220 },
    { label: '直流内阻', unit: 'uΩ', value: resistanceUohm, min: 150, max: 1400, safeLow: 250, safeHigh: 850 },
    { label: '放电容量', unit: 'mAh', value: capacityMah, min: 2200, max: 3600, safeLow: 2750, safeHigh: 3350 },
    { label: '测试温度', unit: '°C', value: temperatureC, min: 0, max: 55, safeLow: 15, safeHigh: 35 },
  ];

  return (
    <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {specs.map(s => {
        const span = Math.max(1, s.max - s.min);
        const safeStart = ((s.safeLow - s.min) / span) * 100;
        const safeWidth = ((s.safeHigh - s.safeLow) / span) * 100;
        const pos = Math.max(2, Math.min(98, ((s.value - s.min) / span) * 100));
        const inRange = s.value >= s.safeLow && s.value <= s.safeHigh;
        return (
          <div key={s.label} className="rounded-xl border border-line bg-white p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink-secondary">{s.label}</span>
              <span className={`mono font-bold ${inRange ? 'text-success' : 'text-danger'}`}>
                {s.value} {s.unit}
              </span>
            </div>
            <div className="relative mt-2 h-2.5 w-full rounded-full bg-subtle">
              <div
                className="absolute top-0 bottom-0 rounded-full bg-success/25 ring-1 ring-success/35"
                style={{ left: `${safeStart}%`, width: `${safeWidth}%` }}
              />
              <span
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ${
                  inRange ? 'bg-success' : 'bg-danger'
                }`}
                style={{ left: `${pos}%` }}
              />
            </div>
            <div className="mono mt-1 flex items-center justify-between text-[10px] text-ink-muted">
              <span>安全下限 {s.safeLow}</span>
              <span>安全上限 {s.safeHigh}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * P1: Stacked Batch Yield Bars (/inspections)
 */
export function BatchYieldBars({
  batches,
}: {
  batches: { id: string; passed: number; review: number; rejected: number; total: number }[];
}) {
  if (batches.length === 0) return null;
  return (
    <div className="card-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-ink">各电芯批次质检良率分布</div>
        <div className="flex items-center gap-3 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />合格</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />待复核</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" />不合格</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {batches.slice(0, 6).map(b => {
          const total = Math.max(1, b.total);
          const pPct = Math.round((b.passed / total) * 100);
          const rPct = Math.round((b.review / total) * 100);
          const xPct = Math.round((b.rejected / total) * 100);
          return (
            <div key={b.id} className="subtle-surface p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="mono truncate font-bold text-ink">{b.id}</span>
                <span className="mono font-bold text-success">{pPct}%</span>
              </div>
              <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-line">
                {pPct > 0 && <div className="bg-success" style={{ width: `${pPct}%` }} />}
                {rPct > 0 && <div className="bg-warning" style={{ width: `${rPct}%` }} />}
                {xPct > 0 && <div className="bg-danger" style={{ width: `${xPct}%` }} />}
              </div>
              <div className="mono mt-1.5 flex items-center justify-between text-[10.5px] text-ink-secondary">
                <span>合格 {b.passed}</span>
                <span>复核 {b.review}</span>
                <span className={b.rejected > 0 ? 'font-bold text-danger' : ''}>异常 {b.rejected}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * P1: Compact Endorsement Progress Ring + Countdown Window Bar (/approvals)
 */
export function ApprovalRingProgress({
  approved,
  required,
}: {
  approved: number;
  required: number;
}) {
  const safeReq = Math.max(1, required);
  const ratio = Math.min(1, approved / safeReq);
  const r = 18;
  const c = 2 * Math.PI * r;
  const complete = approved >= safeReq;

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#dce4ee" strokeWidth="4.5" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={complete ? '#149672' : '#2563eb'}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={`${ratio * c} ${c}`}
        />
      </svg>
      <span className="mono absolute text-[11px] font-bold text-ink">
        {approved}/{safeReq}
      </span>
    </div>
  );
}

export function WindowCountdownBar({
  expiresAt,
  windowSeconds,
  now,
  completed,
}: {
  expiresAt: string;
  windowSeconds: number;
  now: number;
  completed: boolean;
}) {
  if (completed) return null;
  const remainingSec = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const totalSec = Math.max(60, windowSeconds || 600);
  const pct = Math.min(100, Math.round((remainingSec / totalSec) * 100));
  const expired = remainingSec <= 0;
  const urgent = !expired && pct <= 25;

  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;

  return (
    <div className="mt-2.5 space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-ink-secondary">
          <Clock className="h-3 w-3" />
          审批窗口剩余时效
        </span>
        <span
          className={`mono font-bold ${
            expired ? 'text-danger' : urgent ? 'text-[#b07612]' : 'text-teal'
          }`}
        >
          {expired ? '已超时失效' : `${mins}分 ${secs.toString().padStart(2, '0')}秒`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            expired ? 'bg-danger' : urgent ? 'bg-warning' : 'bg-gradient-to-r from-brand to-teal'
          }`}
          style={{ width: `${expired ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * P1: Audit Anchor Ring + Dual-Color Outcome Timeline Bars (/audit)
 */
export function AuditAnalyticsStrip({
  totalLogs,
  anchoredLogs,
  transactions,
}: {
  totalLogs: number;
  anchoredLogs: number;
  transactions: { action: string; stage: string }[];
}) {
  const anchorPct = totalLogs > 0 ? Math.round((anchoredLogs / totalLogs) * 100) : 100;
  const r = 24;
  const c = 2 * Math.PI * r;

  // Group transactions by action (top 6 actions) for dual-color bars
  const actionMap = new Map<string, { ok: number; rejected: number }>();
  for (const tx of transactions) {
    const entry = actionMap.get(tx.action) ?? { ok: 0, rejected: 0 };
    if (tx.stage === 'rejected' || tx.stage === 'invalid') entry.rejected += 1;
    else entry.ok += 1;
    actionMap.set(tx.action, entry);
  }
  const topActions = Array.from(actionMap.entries())
    .map(([action, counts]) => ({ action, ...counts, total: counts.ok + counts.rejected }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const maxVal = Math.max(1, ...topActions.map(a => a.total));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="card-surface flex items-center gap-4 p-4 lg:col-span-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="30" cy="30" r={r} fill="none" stroke="#dce4ee" strokeWidth="6" />
            <circle
              cx="30"
              cy="30"
              r={r}
              fill="none"
              stroke="#149672"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(anchorPct / 100) * c} ${c}`}
            />
          </svg>
          <span className="mono absolute inset-0 flex items-center justify-center text-xs font-bold text-ink">
            {anchorPct}%
          </span>
        </div>
        <div className="min-w-0 text-xs">
          <div className="font-bold text-ink">安全日志上链锚定率</div>
          <div className="mono mt-1 text-ink-secondary">
            已锚定 <strong className="text-success">{anchoredLogs}</strong> / 共 {totalLogs} 条
          </div>
          <div className="mt-1 text-[11px] text-ink-muted">Ed25519 摘要批次周期性写入区块链账本</div>
        </div>
      </div>

      <div className="card-surface p-4 lg:col-span-8">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-bold text-ink">交易动作分布（放行上链 vs 安全拦截）</span>
          <div className="flex items-center gap-3 text-[11px] text-ink-secondary">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />通过/上链</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" />拦截/拒绝</span>
          </div>
        </div>
        {topActions.length === 0 ? (
          <div className="py-4 text-center text-xs text-ink-muted">暂无交易记录分布</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {topActions.map(item => {
              const okH = Math.round((item.ok / maxVal) * 56);
              const rejH = Math.round((item.rejected / maxVal) * 56);
              return (
                <div key={item.action} className="flex flex-col items-center">
                  <div className="flex h-16 items-end gap-1.5">
                    <div
                      title={`通过 ${item.ok}`}
                      className="w-4 rounded-t-md bg-gradient-to-t from-success to-emerald-400 transition-all"
                      style={{ height: `${Math.max(item.ok > 0 ? 6 : 2, okH)}px` }}
                    />
                    <div
                      title={`拦截 ${item.rejected}`}
                      className="w-4 rounded-t-md bg-gradient-to-t from-danger to-rose-400 transition-all"
                      style={{ height: `${Math.max(item.rejected > 0 ? 6 : 2, rejH)}px` }}
                    />
                  </div>
                  <div className="mono mt-1.5 max-w-full truncate text-[10px] font-semibold text-ink-secondary" title={item.action}>
                    {item.action}
                  </div>
                  <div className="mono text-[10px] text-ink-muted">
                    {item.ok}/{item.rejected}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * P1: Active Defense Matrix Scoreboard (/lab)
 */
export function DefenseMatrixBoard({
  presets,
  results,
  selectedId,
  onSelect,
}: {
  presets: { id: string; title: string; defenseLayer: string }[];
  results: Partial<Record<string, { blocked: boolean; stateUnchanged: boolean }>>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const executed = presets.filter(p => Boolean(results[p.id])).length;
  const blockedCount = presets.filter(p => results[p.id]?.blocked && results[p.id]?.stateUnchanged).length;
  const rate = executed > 0 ? Math.round((blockedCount / executed) * 100) : 100;
  const r = 24;
  const c = 2 * Math.PI * r;

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="navy-subcard flex items-center gap-4 p-4 lg:col-span-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="30" cy="30" r={r} fill="none" stroke="#183252" strokeWidth="6" />
            <circle
              cx="30"
              cy="30"
              r={r}
              fill="none"
              stroke={executed === 0 ? '#38bdf8' : rate === 100 ? '#14b8a6' : '#f43f5e'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(rate / 100) * c} ${c}`}
            />
          </svg>
          <span className="mono absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
            {executed > 0 ? `${rate}%` : '待测'}
          </span>
        </div>
        <div className="text-xs">
          <div className="font-bold text-white">主动防御拦截记分板</div>
          <div className="mono mt-1 text-slate-300">
            已验证 <strong className="text-teal-300">{blockedCount}</strong> / {presets.length} 项攻击向量
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">每次演练自动比对前后账本哈希，确保零污染</div>
        </div>
      </div>

      <div className="navy-subcard p-4 lg:col-span-8">
        <div className="mb-2.5 flex items-center justify-between text-xs">
          <span className="font-bold text-white">A1–A8 防御矩阵状态格（点击定位）</span>
          <span className="text-[11px] text-slate-400">绿盾 = 拦截成功且账本零篡改</span>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {presets.map(p => {
            const res = results[p.id];
            const passed = Boolean(res?.blocked && res?.stateUnchanged);
            const failed = Boolean(res && !passed);
            const isSel = selectedId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                title={`${p.title}（${p.defenseLayer}）`}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border py-2 text-xs transition ${
                  passed
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                    : failed
                      ? 'border-rose-400/60 bg-rose-500/20 text-rose-200'
                      : 'border-[#1f3d61] bg-[#0a192c] text-slate-300 hover:border-sky-400/40'
                } ${isSel ? 'ring-2 ring-sky-400/70' : ''}`}
              >
                {passed ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                ) : failed ? (
                  <ShieldAlert className="h-4 w-4 text-rose-300" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 opacity-35" />
                )}
                <span className="mono text-[11px] font-bold">{p.id}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * P2: Global Transfer Stage Distribution & Inter-Org Flow Strip (/transfers)
 */
export function TransferFlowOverview({
  transfers,
}: {
  transfers: { state: string; fromMSP: string; toMSP: string }[];
}) {
  const stages = [
    { key: 'CREATED', label: '待发出', color: 'bg-brand' },
    { key: 'SENT', label: '待签收', color: 'bg-warning' },
    { key: 'ACCEPTED', label: '待提交', color: 'bg-teal' },
    { key: 'COMMITTED', label: '已完成', color: 'bg-success' },
    { key: 'CANCELLED', label: '已取消', color: 'bg-slate-400' },
  ];
  const counts = stages.map(s => ({ ...s, count: transfers.filter(t => t.state === s.key).length }));
  const total = Math.max(1, transfers.length);

  const flowMap = new Map<string, number>();
  for (const t of transfers) {
    const key = `${t.fromMSP.replace('OrgMSP', '')} → ${t.toMSP.replace('OrgMSP', '')}`;
    flowMap.set(key, (flowMap.get(key) ?? 0) + 1);
  }
  const flows = Array.from(flowMap.entries()).slice(0, 4);

  return (
    <div className="card-surface grid grid-cols-1 gap-4 p-4 lg:grid-cols-12">
      <div className="space-y-2 lg:col-span-7">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-ink">交接单全阶段流转分布</span>
          <span className="mono text-[11px] text-ink-secondary">共 {transfers.length} 笔交接单</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-subtle">
          {transfers.length > 0 &&
            counts.map(c =>
              c.count > 0 ? (
                <div
                  key={c.key}
                  title={`${c.label}: ${c.count}`}
                  className={`${c.color} transition-all`}
                  style={{ width: `${Math.max(4, Math.round((c.count / total) * 100))}%` }}
                />
              ) : null,
            )}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-ink-secondary">
          {counts.map(c => (
            <span key={c.key} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${c.color}`} />
              <span>{c.label}</span>
              <strong className="mono text-ink">{c.count}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col justify-center gap-2 border-t border-line pt-3 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
        <div className="text-xs font-bold text-ink">企业间流向统计</div>
        {flows.length === 0 ? (
          <div className="text-xs text-ink-muted">暂无跨企业流向记录</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {flows.map(([route, cnt]) => (
              <span
                key={route}
                className="mono inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-semibold text-ink"
              >
                <span>{route}</span>
                <span className="rounded-full bg-brand/12 px-1.5 text-[10px] text-brand">{cnt}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * P2: Policy Before vs After Impact Comparison Bars (/policies)
 */
export function PolicyImpactBars({
  currentRequired,
  currentHighRisk,
  currentWindowSec,
  candidateWindowSec,
  candidateCount,
}: {
  currentRequired: number;
  currentHighRisk: number;
  currentWindowSec: number;
  candidateWindowSec: number;
  candidateCount: number;
}) {
  const maxOrgs = 4;
  const maxWin = Math.max(3600, currentWindowSec, candidateWindowSec);

  const metrics = [
    {
      label: '常规审批组织门槛',
      before: currentRequired,
      after: Math.max(currentRequired, 2),
      unit: '组织',
      max: maxOrgs,
    },
    {
      label: '高风险附加复核组织',
      before: currentHighRisk,
      after: Math.max(currentHighRisk, 3),
      unit: '组织',
      max: maxOrgs,
    },
    {
      label: '放行审批窗口时长',
      before: currentWindowSec,
      after: candidateWindowSec,
      unit: 's',
      max: maxWin,
    },
  ];

  return (
    <div className="card-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-ink">策略变更前后参数对照预演</span>
        <div className="flex items-center gap-3 text-[11px] text-ink-secondary">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />当前生效</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand" />候选预演</span>
          <span className="mono rounded-full bg-subtle px-2 py-0.5 text-[10px]">历史提案 {candidateCount}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {metrics.map(m => (
          <div key={m.label} className="subtle-surface space-y-2 p-3 text-xs">
            <div className="font-semibold text-ink">{m.label}</div>
            <div className="space-y-1.5">
              <div>
                <div className="mono flex justify-between text-[10.5px] text-ink-secondary">
                  <span>当前</span>
                  <span>{m.before} {m.unit}</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: `${Math.max(6, Math.round((m.before / m.max) * 100))}%` }} />
                </div>
              </div>
              <div>
                <div className="mono flex justify-between text-[10.5px] font-semibold text-brand">
                  <span>候选</span>
                  <span>{m.after} {m.unit}</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand to-teal" style={{ width: `${Math.max(6, Math.round((m.after / m.max) * 100))}%` }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
