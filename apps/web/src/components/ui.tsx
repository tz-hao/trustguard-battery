'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'navy' | 'secondary' | 'ghost' | 'success' | 'danger' | 'teal';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-xs hover:bg-brand-hover active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100',
  navy: 'bg-navy-900 text-white shadow-xs hover:bg-navy-800 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100',
  teal: 'bg-teal text-white shadow-xs hover:bg-[#0c8575] active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100',
  success:
    'bg-success text-white shadow-xs hover:bg-[#118061] active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100',
  danger:
    'bg-danger text-white shadow-xs hover:bg-[#c54141] active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100',
  secondary:
    'border border-line bg-surface text-ink shadow-2xs hover:border-brand/40 hover:bg-subtle/60 active:scale-[0.99] disabled:opacity-50',
  ghost: 'text-ink-secondary hover:bg-subtle hover:text-ink disabled:opacity-50',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'rounded-md px-2.5 py-1 text-xs gap-1',
  sm: 'rounded-lg px-3 py-1.5 text-xs gap-1.5',
  md: 'rounded-lg px-4 py-2 text-xs sm:text-[13px] gap-1.5',
  lg: 'rounded-xl px-5 py-2.5 text-sm gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex cursor-pointer items-center justify-center font-semibold transition duration-150 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({
  className = '',
  invalid = false,
  mono = false,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean }) {
  return (
    <input
      className={`w-full rounded-lg border bg-white px-3 py-2 text-xs text-ink outline-none transition placeholder:text-ink-muted disabled:bg-subtle/70 disabled:text-ink-muted ${
        mono ? 'mono' : ''
      } ${
        invalid
          ? 'border-danger/60 ring-2 ring-danger/15 focus:border-danger'
          : 'border-line hover:border-ink-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/15'
      } ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = '',
  mono = false,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { mono?: boolean }) {
  return (
    <select
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink outline-none transition hover:border-ink-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-subtle/70 disabled:text-ink-muted ${
        mono ? 'mono' : ''
      } ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  validText,
  action,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  validText?: string | null;
  action?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink-secondary">
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-danger">{error}</p>
      ) : validText ? (
        <p className="text-[11px] font-medium text-success">{validText}</p>
      ) : hint ? (
        <p className="text-[11px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return <div className={`${dark ? 'skeleton-block-dark' : 'skeleton-block'} ${className}`} aria-hidden="true" />;
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 py-2" role="status" aria-label="正在加载数据">
      <div className="flex gap-3">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/5" />
        <Skeleton className="h-4 flex-1" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-line/60 p-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

function AnimatedNumber({ target }: { target: number }) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const startVal = prevRef.current;
    prevRef.current = target;
    if (startVal === target) return;
    let rafId = 0;
    const duration = 420;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(startVal + (target - startVal) * eased));
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target]);

  return <>{display}</>;
}

function MiniSparkline({ points, stroke }: { points: number[]; stroke: string }) {
  const gradId = useId();
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = Math.max(1, max - min);
  const w = 68;
  const h = 24;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - 3 - ((v - min) / span) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${h} ${coords.join(' ')} ${w},${h}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SPARK_COLORS = {
  default: '#94a3b8',
  brand: '#38bdf8',
  teal: '#2dd4bf',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
} as const;

export function KpiStatCard({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  dark = false,
  sparkline,
  pulseAlert = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'brand' | 'teal' | 'success' | 'warning' | 'danger';
  dark?: boolean;
  sparkline?: number[];
  pulseAlert?: boolean;
}) {
  const darkBorder: Record<typeof tone, string> = {
    default: 'border-[#1f3d61]',
    brand: 'border-t-2 border-t-[#38bdf8] border-[#1f3d61]',
    teal: 'border-t-2 border-t-[#14b8a6] border-[#1f3d61]',
    success: 'border-t-2 border-t-[#10b981] border-[#1f3d61]',
    warning: 'border-t-2 border-t-[#f59e0b] border-[#1f3d61]',
    danger: 'border-t-2 border-t-[#f43f5e] border-[#1f3d61]',
  };
  const lightRail: Record<typeof tone, string> = {
    default: '',
    brand: 'card-accent-blue',
    teal: 'card-accent-teal',
    success: 'card-accent-emerald',
    warning: 'card-accent-amber',
    danger: 'card-accent-danger',
  };
  const valueTone: Record<typeof tone, string> = {
    default: dark ? 'text-white' : 'text-ink',
    brand: dark ? 'text-sky-200' : 'text-brand',
    teal: dark ? 'text-teal-200' : 'text-teal',
    success: dark ? 'text-emerald-300' : 'text-success',
    warning: dark ? 'text-amber-300' : 'text-warning',
    danger: dark ? 'text-rose-300' : 'text-danger',
  };

  const renderedValue = typeof value === 'number' ? <AnimatedNumber target={value} /> : value;

  if (dark) {
    return (
      <div className={`navy-subcard group p-4 hover:-translate-y-0.5 ${darkBorder[tone]}`}>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
          <span className="flex items-center gap-1.5 font-medium">
            {pulseAlert && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
            )}
            <span>{label}</span>
          </span>
          {icon && (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10 transition group-hover:bg-white/10">
              {icon}
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <div className={`kpi-value text-[30px] leading-none font-bold ${valueTone[tone]}`}>{renderedValue}</div>
          {sparkline && sparkline.length >= 2 && <MiniSparkline points={sparkline} stroke={SPARK_COLORS[tone]} />}
        </div>
        {sub && <div className="mt-2 text-[11px] leading-snug text-slate-200/90">{sub}</div>}
      </div>
    );
  }

  return (
    <div className={`card-surface card-interactive p-4 ${lightRail[tone]}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
        <span className="flex items-center gap-1.5 font-medium">
          {pulseAlert && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
            </span>
          )}
          <span>{label}</span>
        </span>
        {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-subtle">{icon}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className={`kpi-value text-[28px] leading-none font-bold ${valueTone[tone]}`}>{renderedValue}</div>
        {sparkline && sparkline.length >= 2 && <MiniSparkline points={sparkline} stroke={SPARK_COLORS[tone]} />}
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-ink-secondary">{sub}</div>}
    </div>
  );
}
