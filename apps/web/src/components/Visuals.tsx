'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Layers, ShieldCheck, X } from 'lucide-react';

/**
 * Official TrustGuard Battery Brand Logo (智权链 · 锂安溯)
 * Renders the official brand emblem (/brand/logo-mark.png) or full lockup (/brand/logo-full.jpg).
 */
export function TrustGuardBrandLogo({
  size = 'md',
  variant = 'mark',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'mark' | 'full';
  className?: string;
}) {
  const dim = size === 'xl' ? 116 : size === 'lg' ? 76 : size === 'md' ? 46 : 36;
  const radius = size === 'xl' ? 'rounded-3xl' : size === 'lg' ? 'rounded-2xl' : 'rounded-xl';
  const isMark = variant === 'mark';
  const src = isMark ? '/brand/logo-mark.png' : '/brand/logo-full.jpg';

  return (
    <div
      style={{ width: dim, height: dim }}
      className={`relative flex shrink-0 items-center justify-center ${
        isMark
          ? 'drop-shadow-[0_6px_16px_rgba(14,165,233,0.32)]'
          : `overflow-hidden ${radius} ring-1 ring-sky-300/35 shadow-md shadow-sky-950/35`
      } ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="智权链·锂安溯 TrustGuard Battery"
        width={dim}
        height={dim}
        className={`h-full w-full select-none ${isMark ? 'object-contain' : 'object-cover'}`}
      />
    </div>
  );
}

type LayerKey = 'PACK' | 'MODULE' | 'CELL';

/**
 * Interactive Hero Exploded Battery Pack Showcase for the Security Command Cockpit
 * Hovering or clicking PACK / MODULE / CELL highlights the corresponding structural layer
 * and updates the right-side live breakdown panel.
 */
export function BatteryPackExplodedVisual({
  cells,
  modules,
  packs,
  reviewCount,
}: {
  cells: number;
  modules: number;
  packs: number;
  reviewCount: number;
}) {
  const [activeLayer, setActiveLayer] = useState<LayerKey>('PACK');

  const layerDetails: Record<
    LayerKey,
    { title: string; badge: string; count: number; unit: string; color: string; desc: string; href: string }
  > = {
    PACK: {
      title: '车规级动力电池包总成',
      badge: 'PACK 层级',
      count: packs,
      unit: 'PACK',
      color: '#38bdf8',
      desc: '承载整车装机、跨企业双向交接与多组织联合放行审批的核心主资产。',
      href: '/identity',
    },
    MODULE: {
      title: '串并联模组总成',
      badge: 'MODULE 层级',
      count: modules,
      unit: 'MOD',
      color: '#f59e0b',
      desc: '上承电池包总成、下接单体电芯阵列，记录版本化装配授权与绑定边。',
      href: '/trace',
    },
    CELL: {
      title: '单体动力电芯矩阵',
      badge: 'CELL 层级',
      count: cells,
      unit: 'CELL',
      color: '#2dd4bf',
      desc: '绑定原料批次与 24 位国家标准编码，支持质量缺陷溯源与批次定向召回。',
      href: '/inspections',
    },
  };

  const current = layerDetails[activeLayer];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sky-400/20 bg-[#071323] p-4 sm:p-5">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage:
            'radial-gradient(circle at 42% 52%, rgba(15, 157, 138, 0.22), transparent 54%), radial-gradient(circle at 78% 18%, rgba(37, 99, 235, 0.24), transparent 46%)',
        }}
      />
      <div className="relative grid grid-cols-1 items-center gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="relative overflow-hidden rounded-xl border border-sky-400/20 bg-[#060f1d]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/visuals/battery-exploded.jpg"
              alt="动力电池包三层结构剖面 3D 渲染图（电芯、模组、电池包）"
              className="h-[250px] w-full object-cover object-center select-none sm:h-[285px]"
            />
            {/* Soft edge vignette blending studio background into deep-navy panel */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgba(6,15,29,0.55) 0%, transparent 18%, transparent 68%, rgba(6,15,29,0.88) 100%)',
              }}
            />

            {/* Interactive HUD Callout Badges aligned to the 3 exploded layers */}
            <div className="absolute inset-y-3 right-3 flex flex-col justify-between gap-2 sm:right-4">
              {(
                [
                  {
                    key: 'PACK' as const,
                    label: '动力电池包',
                    val: `${packs} PACK`,
                    dot: 'bg-sky-400',
                    activeCls: 'border-sky-400 bg-[#0d2744]/95 ring-2 ring-sky-400/35',
                    textCls: 'text-sky-300',
                  },
                  {
                    key: 'MODULE' as const,
                    label: '串并联模组',
                    val: `${modules} MOD`,
                    dot: 'bg-amber-400',
                    activeCls: 'border-amber-400 bg-[#0d2744]/95 ring-2 ring-amber-400/35',
                    textCls: 'text-amber-300',
                  },
                  {
                    key: 'CELL' as const,
                    label: '单体电芯',
                    val: `${cells} CELL`,
                    dot: 'bg-teal-400',
                    activeCls: 'border-teal-400 bg-[#0d2744]/95 ring-2 ring-teal-400/35',
                    textCls: 'text-teal-300',
                  },
                ] as const
              ).map(badge => {
                const isAct = activeLayer === badge.key;
                return (
                  <button
                    key={badge.key}
                    type="button"
                    onMouseEnter={() => setActiveLayer(badge.key)}
                    onClick={() => setActiveLayer(badge.key)}
                    className={`flex min-w-[116px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-left backdrop-blur-md transition ${
                      isAct
                        ? badge.activeCls
                        : 'border-white/15 bg-[#08172b]/80 hover:border-sky-400/45 hover:bg-[#0c223d]/90'
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />
                    <div className="min-w-0">
                      <div className={`text-[10px] font-semibold ${badge.textCls}`}>{badge.label}</div>
                      <div className="mono text-xs font-bold text-white">{badge.val}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bottom-left subtle HUD caption (desktop/tablet only so it never overlaps mobile badges) */}
            <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-lg border border-white/15 bg-[#061120]/85 px-2.5 py-1 text-[10.5px] font-medium text-sky-200 backdrop-blur-sm sm:block">
              3D 三级剖面映射 · 点击层级切换详情
            </div>
          </div>
        </div>

        {/* Right Companion Interactive Summary Column */}
        <div className="space-y-3.5 lg:col-span-4">
          <div className="flex items-center justify-between">
            <span className="mono flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-teal-300 uppercase">
              <Layers className="h-3.5 w-3.5" />
              BOM 三级可信谱系映射
            </span>
            <span className="rounded-full border border-teal-400/30 bg-teal/15 px-2.5 py-0.5 text-[10px] font-semibold text-teal-200">
              GB/T 34014
            </span>
          </div>

          {/* Interactive Layer Selector Tabs */}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#1d395a] bg-[#0a192c] p-1">
            {(['PACK', 'MODULE', 'CELL'] as const).map(key => {
              const selected = activeLayer === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveLayer(key)}
                  className={`cursor-pointer rounded-lg py-1.5 text-[11px] font-bold transition ${
                    selected
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {key}
                </button>
              );
            })}
          </div>

          {/* Dynamic Active Layer Detail Box */}
          <div className="rounded-xl border border-[#22456c] bg-[#0c1e34]/90 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white">{current.title}</span>
              <span
                className="mono rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ backgroundColor: `${current.color}28`, color: current.color }}
              >
                {current.count} {current.unit}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">{current.desc}</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <Link
              href="/trace"
              className="rounded-xl border border-[#1f3d61] bg-[#0c1e34] p-2.5 transition hover:border-teal/60 hover:bg-[#132c4a]"
            >
              <div className="text-[11px] text-slate-300">全链谱系图谱</div>
              <div className="mt-0.5 font-bold text-white">批次 → 电芯 → PACK →</div>
            </Link>
            <Link
              href="/inspections"
              className="rounded-xl border border-[#1f3d61] bg-[#0c1e34] p-2.5 transition hover:border-amber-400/60 hover:bg-[#132c4a]"
            >
              <div className="text-[11px] text-slate-300">质量复核门禁</div>
              <div className="kpi-value mt-0.5 font-bold text-amber-300">{reviewCount} 项待核验 →</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Studio-grade 3D Industrial Product Visuals for Battery PACK / MODULE / CELL
 */
export function BatteryStructureSvg({ type }: { type: 'PACK' | 'MODULE' | 'CELL' | string }) {
  const meta =
    type === 'CELL'
      ? { src: '/visuals/battery-cell.jpg', badge: 'CELL · 方壳单体电芯', accent: 'text-teal-300 border-teal-400/35' }
      : type === 'MODULE'
        ? { src: '/visuals/battery-module.jpg', badge: 'MODULE · 串并联模组总成', accent: 'text-amber-300 border-amber-400/35' }
        : { src: '/visuals/battery-pack.jpg', badge: 'PACK · 车规级动力电池包', accent: 'text-sky-300 border-sky-400/35' };

  return (
    <div className="relative h-36 w-full overflow-hidden rounded-xl border border-[#1f3d61] bg-[#060f1d]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={meta.src}
        alt={meta.badge}
        className="h-full w-full object-cover object-center select-none"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#060f1d]/90 to-transparent" />
      <span
        className={`mono pointer-events-none absolute bottom-2 left-2.5 rounded-full border bg-[#061120]/85 px-2.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${meta.accent}`}
      >
        {meta.badge}
      </span>
    </div>
  );
}

/**
 * Interactive Lifecycle Donut Chart for Dashboard
 * Hovering any slice or legend item highlights it and updates the center telemetry readout.
 */
export function LifecycleDonutChart({
  items,
}: {
  items: { key: string; label: string; count: number; color: string }[];
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + i.count, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;

  const activeItem = hoveredKey ? items.find(i => i.key === hoveredKey) : null;
  const centerValue = activeItem ? activeItem.count : total;
  const centerLabel = activeItem
    ? `${activeItem.label} (${total > 0 ? Math.round((activeItem.count / total) * 100) : 0}%)`
    : '全生命周期';

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#17324F" strokeWidth="16" />
          {total > 0 &&
            items.map(item => {
              if (item.count === 0) return null;
              const len = (item.count / total) * c;
              const dashOffset = -offset;
              offset += len;
              const isAct = hoveredKey === item.key;
              const dimmed = hoveredKey !== null && !isAct;
              return (
                <circle
                  key={item.key}
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={isAct ? 21 : 16}
                  strokeOpacity={dimmed ? 0.35 : 1}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={dashOffset}
                  onMouseEnter={() => setHoveredKey(item.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className="cursor-pointer transition-all duration-200"
                />
              );
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
          <span className="kpi-value text-2xl font-bold text-white">{centerValue}</span>
          <span className="mt-0.5 max-w-[82px] truncate text-[10px] font-medium text-slate-300">{centerLabel}</span>
        </div>
      </div>

      <div className="min-w-[170px] flex-1 space-y-1.5">
        {items.map(item => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
          const isAct = hoveredKey === item.key;
          return (
            <div
              key={item.key}
              onMouseEnter={() => setHoveredKey(item.key)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs transition ${
                isAct ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </span>
              <span className="mono font-semibold text-white">
                {item.count} <span className="text-[11px] text-slate-400">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Animated Consortium 4-Org Topology SVG (Dashboard & Organizations)
 */
export function ConsortiumTopologySvg({
  organizations,
  ledgerHeight,
  dark = true,
}: {
  organizations: { mspId: string; gatewayEndpoint: string; roles: { name: string; role: string }[] }[];
  ledgerHeight: string;
  dark?: boolean;
}) {
  const nodes = [
    { msp: 'CellOrgMSP', title: '电芯厂 CellOrg', x: 105, y: 55, color: '#38BDF8', port: '17051' },
    { msp: 'LabOrgMSP', title: '检测机构 LabOrg', x: 375, y: 55, color: '#60A5FA', port: '21051' },
    { msp: 'PackOrgMSP', title: 'PACK 厂 PackOrg', x: 105, y: 185, color: '#2DD4BF', port: '19051' },
    { msp: 'RecycleOrgMSP', title: '回收企业 RecycleOrg', x: 375, y: 185, color: '#34D399', port: '23051' },
  ];

  const byMsp = new Map(organizations.map(o => [o.mspId, o]));

  return (
    <svg viewBox="0 0 480 245" className="h-60 w-full">
      <defs>
        <radialGradient id="ordererHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0F9D8A" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#0F9D8A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="480" height="245" rx="12" fill={dark ? '#071323' : '#F4F7FA'} />
      <circle cx="240" cy="120" r="88" fill="url(#ordererHalo)" />

      {/* Animated data-packet endorsement links */}
      {nodes.map(n => (
        <g key={`link-${n.msp}`}>
          <line x1={n.x} y1={n.y} x2="240" y2="120" stroke={n.color} strokeOpacity="0.22" strokeWidth="2.5" />
          <line
            x1={n.x}
            y1={n.y}
            x2="240"
            y2="120"
            stroke={n.color}
            strokeOpacity="0.85"
            strokeWidth="1.8"
            className="svg-dash-flow"
          />
        </g>
      ))}

      <line x1="175" y1="55" x2="295" y2="55" stroke="#64748B" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 4" />
      <line x1="105" y1="88" x2="105" y2="148" stroke="#64748B" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 4" />
      <line x1="175" y1="185" x2="295" y2="185" stroke="#64748B" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 4" />

      <rect
        x="174"
        y="91"
        width="132"
        height="58"
        rx="12"
        fill="#0F233B"
        stroke="#2DD4BF"
        strokeWidth="1.8"
      />
      <text x="240" y="111" textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff">
        Raft Orderer :17050
      </text>
      <text x="240" y="125" textAnchor="middle" fontSize="9" fill="#94A3B8">
        通道 batterybusiness
      </text>
      <text x="240" y="140" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#34D399" className="mono">
        共识高度 #{ledgerHeight}
      </text>

      {nodes.map(n => {
        const org = byMsp.get(n.msp);
        return (
          <g key={n.msp}>
            <rect
              x={n.x - 82}
              y={n.y - 30}
              width="164"
              height="60"
              rx="10"
              fill={dark ? '#0F233B' : '#FFFFFF'}
              stroke={n.color}
              strokeOpacity="0.78"
              strokeWidth="1.5"
            />
            <circle cx={n.x - 68} cy={n.y - 12} r="6" fill="#34D399" fillOpacity="0.22" />
            <circle cx={n.x - 68} cy={n.y - 12} r="3.2" fill="#34D399" />
            <text x={n.x - 58} y={n.y - 9} fontSize="10.5" fontWeight="700" fill={dark ? '#FFFFFF' : '#132638'}>
              {n.title}
            </text>
            <text x={n.x - 68} y={n.y + 6} fontSize="9" fill={dark ? '#94A3B8' : '#64748B'}>
              Peer :{n.port} · {org?.roles.length ?? 0} 证书角色
            </text>
            <text x={n.x - 68} y={n.y + 20} fontSize="8.5" fill={n.color}>
              {n.msp} · 在线背书
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Reusable Right-Side Detail Drawer (with Escape close & scroll lock)
 */
export function SlideDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#06101e]/65 backdrop-blur-[3px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="animate-page-in flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="page-header-strip flex items-start justify-between gap-3 rounded-none border-x-0 border-t-0 px-6 py-4 text-white">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" />
            <div>
              <h3 className="text-base font-bold">{title}</h3>
              {subtitle && <p className="mt-0.5 text-xs text-slate-300">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭抽屉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

/**
 * Reusable Table Pagination Control
 */
export function PaginationBar({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (next: number) => void;
}) {
  if (totalItems === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-secondary">
      <span>
        共 <strong className="mono text-ink">{totalItems}</strong> 条记录 · 第{' '}
        <strong className="mono text-ink">{page}</strong> / {Math.max(1, totalPages)} 页
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-brand/40 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-brand/40 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45"
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
