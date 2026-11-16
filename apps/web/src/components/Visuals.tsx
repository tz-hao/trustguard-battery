'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * High-precision industrial SVG schematics for Battery PACK / MODULE / CELL
 */
export function BatteryStructureSvg({ type }: { type: 'PACK' | 'MODULE' | 'CELL' | string }) {
  if (type === 'CELL') {
    return (
      <svg viewBox="0 0 280 150" className="h-36 w-full">
        <rect width="280" height="150" rx="10" fill="#0B192C" />
        {/* Prismatic Lithium Cell Body */}
        <rect x="75" y="26" width="130" height="100" rx="8" fill="#17324F" stroke="#3185D8" strokeWidth="1.8" />
        <rect x="85" y="34" width="110" height="84" rx="4" fill="#10243A" stroke="#0F9D8A" strokeWidth="1" strokeDasharray="3 2" />
        {/* Terminals */}
        <rect x="96" y="16" width="24" height="12" rx="2" fill="#D99A2B" />
        <rect x="160" y="16" width="24" height="12" rx="2" fill="#94A3B8" />
        {/* Vent */}
        <ellipse cx="140" cy="26" rx="10" ry="3" fill="#0F9D8A" />
        {/* Internal jelly-roll layers */}
        {[46, 58, 70, 82, 94, 106].map(y => (
          <line key={y} x1="94" y1={y} x2="186" y2={y} stroke="#2563EB" strokeOpacity="0.45" strokeWidth="2" />
        ))}
        <text x="108" y="14" fontSize="9" fontWeight="700" fill="#D99A2B" textAnchor="middle">
          +
        </text>
        <text x="172" y="14" fontSize="9" fontWeight="700" fill="#CBD5E1" textAnchor="middle">
          -
        </text>
        <text x="140" y="140" fontSize="9.5" fontWeight="600" fill="#94A3B8" textAnchor="middle">
          方壳动力单体电芯 · CELL
        </text>
      </svg>
    );
  }

  if (type === 'MODULE') {
    return (
      <svg viewBox="0 0 280 150" className="h-36 w-full">
        <rect width="280" height="150" rx="10" fill="#0B192C" />
        {/* End plates */}
        <rect x="44" y="34" width="192" height="84" rx="6" fill="#10243A" stroke="#0F9D8A" strokeWidth="1.8" />
        {/* Stacked cells */}
        {[54, 76, 98, 120, 142, 164, 186, 208].map(x => (
          <rect key={x} x={x} y="42" width="16" height="68" rx="2" fill="#17324F" stroke="#3185D8" strokeWidth="1.2" />
        ))}
        {/* Busbar */}
        <rect x="52" y="36" width="176" height="6" rx="2" fill="#D99A2B" fillOpacity="0.85" />
        <text x="140" y="138" fontSize="9.5" fontWeight="600" fill="#94A3B8" textAnchor="middle">
          串并联电池模组总成 · MODULE
        </text>
      </svg>
    );
  }

  // PACK schematic inspired by industrial battery cutaway
  return (
    <svg viewBox="0 0 280 150" className="h-36 w-full">
      <rect width="280" height="150" rx="10" fill="#0B192C" />
      {/* Outer tray */}
      <polygon points="32,46 218,24 252,58 252,112 72,130 32,96" fill="#10243A" stroke="#3185D8" strokeWidth="1.6" />
      {/* Internal modules */}
      {[
        { x: 56, y: 54 },
        { x: 96, y: 49 },
        { x: 136, y: 44 },
        { x: 176, y: 39 },
      ].map((m, idx) => (
        <g key={idx}>
          <rect
            x={m.x}
            y={m.y}
            width="32"
            height="54"
            rx="3"
            transform="skewY(-6)"
            fill="#17324F"
            stroke="#0F9D8A"
            strokeWidth="1.3"
          />
          <line x1={m.x + 6} y1={m.y + 8} x2={m.x + 26} y2={m.y + 6} stroke="#3185D8" strokeWidth="1.5" />
        </g>
      ))}
      {/* HV Busbar & BDU */}
      <path d="M 46 86 L 216 66 L 230 78" fill="none" stroke="#D99A2B" strokeWidth="2.8" strokeLinecap="round" />
      <rect x="218" y="54" width="22" height="30" rx="3" fill="#2563EB" fillOpacity="0.4" stroke="#3185D8" />
      {/* HV Orange connector */}
      <rect x="24" y="74" width="14" height="18" rx="3" fill="#D99A2B" />
      <text x="140" y="142" fontSize="9.5" fontWeight="600" fill="#94A3B8" textAnchor="middle">
        车规级动力电池包总成 · PACK (含 BDU 与高压母排)
      </text>
    </svg>
  );
}

/**
 * Lifecycle Donut Chart for Dashboard
 */
export function LifecycleDonutChart({
  items,
}: {
  items: { key: string; label: string; count: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.count, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#17324F" strokeWidth="18" />
          {total > 0 &&
            items.map(item => {
              if (item.count === 0) return null;
              const len = (item.count / total) * c;
              const dashOffset = -offset;
              offset += len;
              return (
                <circle
                  key={item.key}
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="18"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={dashOffset}
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="mono text-2xl font-bold text-white">{total}</span>
          <span className="text-[10px] text-slate-400">全生命周期</span>
        </div>
      </div>

      <div className="min-w-[180px] flex-1 space-y-2">
        {items.map(item => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
          return (
            <div key={item.key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-slate-300">
                <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
              </span>
              <span className="mono font-semibold text-white">
                {item.count} <span className="text-[10px] text-slate-400">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Consortium 4-Org Topology SVG (Dashboard & Organizations)
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
    { msp: 'CellOrgMSP', title: '电芯厂 CellOrg', x: 105, y: 55, color: '#2563EB', port: '17051' },
    { msp: 'LabOrgMSP', title: '检测机构 LabOrg', x: 375, y: 55, color: '#3185D8', port: '21051' },
    { msp: 'PackOrgMSP', title: 'PACK 厂 PackOrg', x: 105, y: 185, color: '#0F9D8A', port: '19051' },
    { msp: 'RecycleOrgMSP', title: '回收企业 RecycleOrg', x: 375, y: 185, color: '#159B76', port: '23051' },
  ];

  const byMsp = new Map(organizations.map(o => [o.mspId, o]));

  return (
    <svg viewBox="0 0 480 245" className="h-60 w-full">
      <rect width="480" height="245" rx="10" fill={dark ? '#0B192C' : '#F4F7FA'} />
      {/* Links between peers and central channel/orderer */}
      {nodes.map(n => (
        <line
          key={`link-${n.msp}`}
          x1={n.x}
          y1={n.y}
          x2="240"
          y2="120"
          stroke={n.color}
          strokeOpacity="0.65"
          strokeWidth="1.8"
          strokeDasharray="4 3"
        />
      ))}

      {/* Business flow arrows */}
      <line x1="175" y1="55" x2="295" y2="55" stroke="#64748B" strokeWidth="1.2" />
      <line x1="105" y1="88" x2="105" y2="148" stroke="#64748B" strokeWidth="1.2" />
      <line x1="175" y1="185" x2="295" y2="185" stroke="#64748B" strokeWidth="1.2" />

      {/* Central Orderer & Channel Hub */}
      <rect
        x="176"
        y="92"
        width="128"
        height="56"
        rx="10"
        fill={dark ? '#10243A' : '#10243A'}
        stroke="#0F9D8A"
        strokeWidth="1.8"
      />
      <text x="240" y="112" textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff">
        Raft Orderer :17050
      </text>
      <text x="240" y="126" textAnchor="middle" fontSize="9" fill="#94A3B8">
        通道 batterybusiness
      </text>
      <text x="240" y="140" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#159B76">
        共识高度 #{ledgerHeight}
      </text>

      {/* 4 Org Peer Nodes */}
      {nodes.map(n => {
        const org = byMsp.get(n.msp);
        return (
          <g key={n.msp}>
            <rect
              x={n.x - 82}
              y={n.y - 30}
              width="164"
              height="60"
              rx="8"
              fill={dark ? '#10243A' : '#FFFFFF'}
              stroke={n.color}
              strokeWidth="1.5"
            />
            <circle cx={n.x - 68} cy={n.y - 12} r="3.5" fill="#159B76" />
            <text x={n.x - 58} y={n.y - 9} fontSize="10.5" fontWeight="700" fill={dark ? '#FFFFFF' : '#172B3A'}>
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
 * Reusable Right-Side Detail Drawer
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0b192c]/50 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#dce4ee] bg-[#10243A] px-6 py-4 text-white">
          <div>
            <h3 className="text-base font-bold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-300">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
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
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#dce4ee] pt-3 text-xs text-[#64748B]">
      <span>
        共 <strong className="mono text-[#172B3A]">{totalItems}</strong> 条记录 · 第{' '}
        <strong className="mono text-[#172B3A]">{page}</strong> / {Math.max(1, totalPages)} 页
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center gap-1 rounded-md border border-[#dce4ee] bg-white px-2.5 py-1 text-xs font-medium text-[#172B3A] hover:bg-[#EDF2F7] disabled:opacity-45"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center gap-1 rounded-md border border-[#dce4ee] bg-white px-2.5 py-1 text-xs font-medium text-[#172B3A] hover:bg-[#EDF2F7] disabled:opacity-45"
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
