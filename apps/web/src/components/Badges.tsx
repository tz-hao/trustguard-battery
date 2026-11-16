'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { ERROR_DESCRIPTIONS, ORG_LABELS, QUALITY_LABELS } from '@/lib/types';

export function QualityBadge({ quality }: { quality: string }) {
  const info = QUALITY_LABELS[quality] ?? { label: quality, tone: 'slate' as const };
  const styles = {
    emerald: 'bg-[#159B76]/10 text-[#159B76] border-[#159B76]/30',
    rose: 'bg-[#DC5353]/10 text-[#DC5353] border-[#DC5353]/30',
    amber: 'bg-[#D99A2B]/12 text-[#b07612] border-[#D99A2B]/35',
    slate: 'bg-[#EDF2F7] text-[#64748B] border-[#dce4ee]',
  }[info.tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${styles}`}>
      {quality === 'QC_PASSED' && <CheckCircle2 className="h-3 w-3" />}
      {quality === 'QC_REJECTED' && <XCircle className="h-3 w-3" />}
      {quality === 'REVIEW_REQUIRED' && <AlertTriangle className="h-3 w-3" />}
      {info.label}
    </span>
  );
}

export function LifecycleBadge({ state, label }: { state: string; label?: string }) {
  const color =
    state === 'IN_USE' || state === 'RELEASED'
      ? 'bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/25'
      : state === 'PROCESSED'
        ? 'bg-[#10243A] text-white border-[#10243A]'
        : state === 'RETIRED' || state === 'RECEIVED_FOR_RECYCLING'
          ? 'bg-[#D99A2B]/12 text-[#b07612] border-[#D99A2B]/35'
          : 'bg-[#EDF2F7] text-[#172B3A] border-[#dce4ee]';
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${color}`}>
      {label ?? state}
    </span>
  );
}

const ORG_LIGHT: Record<string, string> = {
  CellOrgMSP: 'bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/25',
  PackOrgMSP: 'bg-[#0F9D8A]/10 text-[#0F9D8A] border-[#0F9D8A]/25',
  LabOrgMSP: 'bg-[#3185D8]/10 text-[#1d5fa3] border-[#3185D8]/25',
  RecycleOrgMSP: 'bg-[#159B76]/10 text-[#159B76] border-[#159B76]/25',
};

const ORG_DARK: Record<string, string> = {
  CellOrgMSP: 'bg-[#2563EB]/20 text-blue-200 border-[#2563EB]/40',
  PackOrgMSP: 'bg-[#0F9D8A]/20 text-teal-200 border-[#0F9D8A]/40',
  LabOrgMSP: 'bg-[#3185D8]/20 text-sky-200 border-[#3185D8]/40',
  RecycleOrgMSP: 'bg-[#159B76]/20 text-emerald-200 border-[#159B76]/40',
};

export function OrgBadge({ mspId, dark = false }: { mspId: string; dark?: boolean }) {
  const palette = dark ? ORG_DARK[mspId] : ORG_LIGHT[mspId];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
        palette ?? (dark ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-[#EDF2F7] text-[#172B3A] border-[#dce4ee]')
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {ORG_LABELS[mspId]?.split(' ')[0] ?? mspId}
    </span>
  );
}

export function SourceTag({ source, dark = false }: { source: string; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
        dark ? 'border-slate-700 bg-slate-800/80 text-slate-300' : 'border-[#dce4ee] bg-[#EDF2F7] text-[#64748B]'
      }`}
    >
      <Info className="h-3 w-3 opacity-75" />
      {source}
    </span>
  );
}

export function DemoTag({ label = 'DEMO · 显式模拟数据' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[#D99A2B]/40 bg-[#D99A2B]/15 px-2 py-0.5 text-[10px] font-bold text-[#b07612]">
      {label}
    </span>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const cls =
    stage === 'ledger-verified'
      ? 'border-[#159B76]/30 bg-[#159B76]/10 text-[#159B76]'
      : stage === 'rejected' || stage === 'invalid'
        ? 'border-[#DC5353]/30 bg-[#DC5353]/10 text-[#DC5353]'
        : stage === 'committed' || stage === 'endorsed'
          ? 'border-[#2563EB]/30 bg-[#2563EB]/10 text-[#2563EB]'
          : 'border-[#D99A2B]/35 bg-[#D99A2B]/12 text-[#b07612]';
  return (
    <span className={`mono inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {stage === 'ledger-verified' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {stage}
    </span>
  );
}

export function HashChip({
  value,
  label,
  head = 8,
  tail = 6,
  dark = false,
}: {
  value: string | null | undefined;
  label?: string;
  head?: number;
  tail?: number;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="mono text-[11px] text-[#94A3B8]">—</span>;
  const shortened = value.length <= head + tail + 3 ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;

  function copy() {
    if (!value || typeof navigator === 'undefined') return;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`点击复制完整值：${value}`}
      className={`mono inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition ${
        dark
          ? 'border-[#1e3a5c] bg-[#0b192c] text-slate-200 hover:border-[#3185D8]'
          : 'border-[#dce4ee] bg-[#EDF2F7] text-[#172B3A] hover:border-[#2563EB]/40 hover:bg-blue-50/50'
      }`}
    >
      {label && <span className="text-[10px] opacity-65">{label}:</span>}
      <span>{shortened}</span>
      {copied ? <Check className="h-3 w-3 text-[#159B76]" /> : <Copy className="h-2.5 w-2.5 opacity-55" />}
    </button>
  );
}

export function PageBanner({
  code,
  title,
  subtitle,
  right,
}: {
  code: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-header-strip px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono rounded bg-[#2563EB]/25 px-2 py-0.5 text-[10px] font-bold tracking-wider text-blue-200 ring-1 ring-blue-400/30">
              {code}
            </span>
            <span className="rounded bg-[#0F9D8A]/20 px-2 py-0.5 text-[10px] font-semibold text-teal-200">
              Hyperledger Fabric · batterybusiness
            </span>
            <span className="rounded bg-[#D99A2B]/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              DEMO 模拟业务数据
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h1>
          <p className="text-xs text-slate-300">{subtitle}</p>
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  icon,
  action,
  dark = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className={`flex items-center gap-2 text-sm font-bold ${dark ? 'text-white' : 'text-[#172B3A]'}`}>
          {icon}
          <span>{title}</span>
        </h2>
        {subtitle && <p className={`mt-0.5 text-[11px] ${dark ? 'text-slate-400' : 'text-[#64748B]'}`}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function BatteryQrBadge({ code, size = 84 }: { code: string; size?: number }) {
  const dim = 13;
  const cells: boolean[] = [];
  let seed = 2166136261;
  for (let i = 0; i < code.length; i++) {
    seed ^= code.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const isFinder = (r: number, c: number) =>
    (r < 4 && c < 4) || (r < 4 && c >= dim - 4) || (r >= dim - 4 && c < 4);

  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      if (isFinder(r, c)) {
        const lr = r >= dim - 4 ? r - (dim - 4) : r;
        const lc = c >= dim - 4 ? c - (dim - 4) : c;
        const border = lr === 0 || lr === 3 || lc === 0 || lc === 3;
        const center = lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2;
        cells.push(border || center);
      } else {
        seed ^= (r * 31 + c * 17 + code.charCodeAt((r + c) % Math.max(1, code.length))) >>> 0;
        seed = Math.imul(seed, 16777619);
        cells.push(((seed >>> 3) & 1) === 1);
      }
    }
  }

  return (
    <div
      className="inline-flex flex-col items-center rounded-lg border border-[#1e3a5c] bg-white p-1.5"
      title={`数字身份矩阵码: ${code}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges">
        <rect width={dim} height={dim} fill="#ffffff" />
        {cells.map((on, idx) =>
          on ? (
            <rect key={idx} x={idx % dim} y={Math.floor(idx / dim)} width={1} height={1} fill="#10243A" />
          ) : null,
        )}
      </svg>
    </div>
  );
}

export interface CommandResultState {
  ok: boolean;
  title: string;
  requestId?: string;
  txId?: string | null;
  stage?: string;
  blockNumber?: string | null;
  errorCode?: string | null;
  detail?: unknown;
}

export function TxResultBanner({ result, onClose }: { result: CommandResultState | null; onClose?: () => void }) {
  if (!result) return null;
  const desc = result.errorCode ? ERROR_DESCRIPTIONS[result.errorCode] : undefined;
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        result.ok
          ? 'border-[#159B76]/35 bg-[#159B76]/10 text-[#0c5e47]'
          : 'border-[#DC5353]/35 bg-[#DC5353]/10 text-[#8f2323]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#159B76]" />
          ) : (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#DC5353]" />
          )}
          <div className="space-y-1">
            <div className="font-semibold">{result.title}</div>
            {desc && <div className="text-xs opacity-90">{desc}</div>}
            <div className="mono flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-85">
              {result.stage && <span>阶段: {result.stage}</span>}
              {result.errorCode && <span>错误码: {result.errorCode}</span>}
              {result.blockNumber && <span>区块: #{result.blockNumber}</span>}
              {result.requestId && <span>requestId: {result.requestId}</span>}
              {result.txId && <span>txId: {result.txId.slice(0, 18)}...</span>}
            </div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-xs font-semibold underline opacity-80 hover:opacity-100">
            收起
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, subtitle, dark = false }: { title: string; subtitle?: string; dark?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center ${
        dark
          ? 'border-[#1e3a5c] bg-[#0b192c]/60 text-slate-300'
          : 'border-[#dce4ee] bg-[#EDF2F7]/60 text-[#172B3A]'
      }`}
    >
      <Clock className={`mb-2 h-7 w-7 ${dark ? 'text-slate-500' : 'text-[#94A3B8]'}`} />
      <div className="text-sm font-semibold">{title}</div>
      {subtitle && <div className={`mt-1 max-w-md text-xs ${dark ? 'text-slate-400' : 'text-[#64748B]'}`}>{subtitle}</div>}
    </div>
  );
}
