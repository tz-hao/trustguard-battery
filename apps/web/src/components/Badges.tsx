'use client';

import { QRCodeSVG } from 'qrcode.react';
import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  Layers,
  Package,
  Recycle,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { ERROR_DESCRIPTIONS, ORG_LABELS, QUALITY_LABELS } from '@/lib/types';

export function QualityBadge({ quality }: { quality: string }) {
  const info = QUALITY_LABELS[quality] ?? { label: quality, tone: 'slate' as const };
  const styles = {
    emerald: 'bg-success/10 text-success border-success/30',
    rose: 'bg-danger/10 text-danger border-danger/30',
    amber: 'bg-warning/12 text-[#a86e0c] border-warning/35',
    slate: 'bg-subtle text-ink-secondary border-line',
  }[info.tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}
    >
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
      ? 'bg-brand/10 text-brand border-brand/25'
      : state === 'PROCESSED'
        ? 'bg-navy-900 text-white border-navy-900'
        : state === 'RETIRED' || state === 'RECEIVED_FOR_RECYCLING'
          ? 'bg-warning/12 text-[#a86e0c] border-warning/35'
          : state === 'INSTALLED'
            ? 'bg-teal/12 text-teal border-teal/30'
            : 'bg-subtle text-ink border-line';
  const Icon =
    state === 'IN_USE'
      ? Activity
      : state === 'PROCESSED'
        ? Ban
        : state === 'RETIRED' || state === 'RECEIVED_FOR_RECYCLING'
          ? Recycle
          : state === 'ASSEMBLED' || state === 'RELEASED' || state === 'INSTALLED'
            ? Layers
            : Package;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${color}`}
    >
      <Icon className="h-3 w-3 opacity-80" />
      {label ?? state}
    </span>
  );
}

const ORG_LIGHT: Record<string, string> = {
  CellOrgMSP: 'bg-brand/10 text-brand border-brand/25',
  PackOrgMSP: 'bg-teal/10 text-teal border-teal/25',
  LabOrgMSP: 'bg-info/10 text-[#1d5fa3] border-info/25',
  RecycleOrgMSP: 'bg-success/10 text-success border-success/25',
};

const ORG_DARK: Record<string, string> = {
  CellOrgMSP: 'bg-brand/20 text-blue-200 border-brand/40',
  PackOrgMSP: 'bg-teal/20 text-teal-200 border-teal/40',
  LabOrgMSP: 'bg-info/20 text-sky-200 border-info/40',
  RecycleOrgMSP: 'bg-success/20 text-emerald-200 border-success/40',
};

export function OrgBadge({ mspId, dark = false }: { mspId: string; dark?: boolean }) {
  const palette = dark ? ORG_DARK[mspId] : ORG_LIGHT[mspId];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        palette ?? (dark ? 'border-slate-700 bg-slate-800 text-slate-200' : 'border-line bg-subtle text-ink')
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
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        dark ? 'border-slate-700 bg-slate-800/80 text-slate-300' : 'border-line bg-subtle text-ink-secondary'
      }`}
    >
      <Info className="h-3 w-3 opacity-75" />
      {source}
    </span>
  );
}

export function DemoTag(props?: { label?: string }) {
  void props;
  return null;
}

export function StagePill({ stage }: { stage: string }) {
  const cls =
    stage === 'ledger-verified' || stage === 'VALID'
      ? 'border-success/30 bg-success/10 text-success'
      : stage === 'rejected' || stage === 'invalid'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : stage === 'committed' || stage === 'endorsed'
          ? 'border-brand/30 bg-brand/10 text-brand'
          : 'border-warning/35 bg-warning/12 text-[#a86e0c]';
  return (
    <span className={`mono inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {stage === 'ledger-verified' || stage === 'VALID' ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
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
  const { notify } = useToast();
  if (!value) return <span className="mono text-[11px] text-ink-muted">—</span>;
  const shortened = value.length <= head + tail + 3 ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;

  function copy() {
    if (!value || typeof navigator === 'undefined') return;
    void navigator.clipboard.writeText(value);
    setCopied(true);
    notify({ tone: 'info', title: `${label ?? '哈希值'}已复制到剪贴板`, description: shortened });
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`点击复制完整值：${value}`}
      className={`mono inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] transition ${
        dark
          ? 'border-[#1e3a5c] bg-navy-950 text-slate-200 hover:border-info'
          : 'border-line bg-subtle text-ink hover:border-brand/40 hover:bg-blue-50/70'
      }`}
    >
      {label && <span className="text-[11px] opacity-65">{label}:</span>}
      <span>{shortened}</span>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-2.5 w-2.5 opacity-55" />}
    </button>
  );
}

export function PageBanner({
  title,
  subtitle,
  right,
}: {
  code?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-header-strip px-5 py-4.5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-bold tracking-tight text-white sm:text-[22px]">{title}</h1>
          {subtitle && <p className="max-w-3xl text-xs leading-relaxed text-slate-300">{subtitle}</p>}
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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className={`flex items-center gap-2 text-[15px] font-bold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>
          {icon}
          <span>{title}</span>
        </h2>
        {subtitle && (
          <p className={`mt-0.5 text-xs leading-relaxed ${dark ? 'text-slate-400' : 'text-ink-secondary'}`}>{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function BatteryQrBadge({ code, size = 84 }: { code: string; size?: number }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return origin ? (
    <div className="rounded-xl border border-line bg-white p-1.5 shadow-2xs">
      <QRCodeSVG
        value={`${origin}/identity?code=${encodeURIComponent(code)}`}
        size={size}
        marginSize={4}
        level="M"
        title="扫描打开电池档案"
      />
    </div>
  ) : null;
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
      role={result.ok ? 'status' : 'alert'}
      className={`animate-page-in rounded-xl border p-4 text-sm shadow-2xs ${
        result.ok
          ? 'border-success/35 bg-success/10 text-[#0c5e47]'
          : 'border-danger/35 bg-danger/10 text-[#8f2323]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          ) : (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          )}
          <div className="space-y-1">
            <div className="font-semibold">{result.title}</div>
            {desc && <div className="text-xs leading-relaxed opacity-90">{desc}</div>}
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
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer text-xs font-semibold underline opacity-80 hover:opacity-100"
          >
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
      className={`flex flex-col items-center justify-center rounded-2xl border border-dashed py-10 text-center ${
        dark
          ? 'border-[#1e3a5c] bg-navy-950/60 text-slate-300'
          : 'border-line bg-subtle/50 text-ink'
      }`}
    >
      <div
        className={`mb-2.5 flex h-11 w-11 items-center justify-center rounded-full ${
          dark ? 'bg-white/5 text-slate-400' : 'bg-white text-ink-muted shadow-xs'
        }`}
      >
        <Clock className="h-5 w-5" />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      {subtitle && (
        <div className={`mt-1 max-w-md text-xs ${dark ? 'text-slate-400' : 'text-ink-secondary'}`}>{subtitle}</div>
      )}
    </div>
  );
}

export function OverviewLoadNotice({
  loading,
  error,
  hasData,
  onRetry,
}: {
  loading: boolean;
  error: number | null;
  hasData: boolean;
  onRetry: () => void;
}) {
  if (error === null) {
    return loading && !hasData ? (
      <div role="status" className="card-surface space-y-3 p-5">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
          正在加载记录…
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="skeleton-block h-16" />
          <div className="skeleton-block h-16" />
          <div className="skeleton-block h-16" />
        </div>
      </div>
    ) : null;
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-ink"
    >
      <div>
        <strong>{error === 429 ? '请求过于频繁（HTTP 429），请稍后重试。' : '记录加载失败，请重试。'}</strong>
        {hasData && <p className="mt-1 text-xs text-ink-secondary">当前显示上次成功加载的记录。</p>}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer rounded-lg bg-navy-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-800"
      >
        重试加载
      </button>
    </div>
  );
}
