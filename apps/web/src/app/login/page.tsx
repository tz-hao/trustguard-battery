'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Eye,
  Factory,
  FileCheck2,
  History,
  Layers,
  Lock,
  Microscope,
  Recycle,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  UserCheck,
  Wrench,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { useToast } from '@/components/ToastProvider';
import {
  ALL_ROUTES,
  CORE_IDENTITY_NAMES,
  ORG_PROFILES,
  canAccessRoute,
  getAllowedRoutes,
  getDefaultRouteForActor,
  getRoleSummaryForIdentity,
  type RouteMeta,
} from '@/lib/permissions';
import type { OrganizationMSP, PublicIdentity } from '@/lib/types';

const LAST_LOGIN_KEY = 'tg_last_login_actor';

const ORG_TECH_META: Record<
  OrganizationMSP,
  {
    code: string;
    shortLabel: string;
    nodeId: string;
    port: string;
    duty: string;
    ledColor: string;
  }
> = {
  CellOrgMSP: {
    code: 'NODE_01',
    shortLabel: '电芯制造',
    nodeId: 'PEER0.CELLORG',
    port: '17051',
    duty: '电芯建档 · 供货授权',
    ledColor: '#38BDF8',
  },
  PackOrgMSP: {
    code: 'NODE_02',
    shortLabel: 'PACK 装配',
    nodeId: 'PEER0.PACKORG',
    port: '19051',
    duty: '模组成组 · 放行交接',
    ledColor: '#2DD4BF',
  },
  LabOrgMSP: {
    code: 'NODE_03',
    shortLabel: '独立检测',
    nodeId: 'PEER0.LABORG',
    port: '21051',
    duty: '加密质检 · 合规审计',
    ledColor: '#60A5FA',
  },
  RecycleOrgMSP: {
    code: 'NODE_04',
    shortLabel: '退役回收',
    nodeId: 'PEER0.RECYCLEORG',
    port: '23051',
    duty: '回收签收 · 报废核销',
    ledColor: '#34D399',
  },
};

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  manufacturer: Factory,
  assembler: Layers,
  inspector: Microscope,
  release: FileCheck2,
  approver: BadgeCheck,
  custodian: ArrowLeftRight,
  operator: Wrench,
  recycler: Recycle,
  auditor: ShieldCheck,
  admin: Settings2,
  viewer: Eye,
};

const AUTH_PROGRESS_FRAMES = [
  '[ ■□□□□ ] AUTHENTICATING...',
  '[ ■■□□□ ] VERIFYING_MTLS...',
  '[ ■■■■□ ] BINDING_SESSION...',
  '[ ■■■■■ ] GATE_UNLOCKED',
];

function readLastLoginActor(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_LOGIN_KEY) : null;
  } catch {
    return null;
  }
}

function saveLastLoginActor(actorName: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_LOGIN_KEY, actorName);
    }
  } catch {
    // ignore storage errors
  }
}

function resolveDeepLinkPath(): string | null {
  if (typeof window === 'undefined') return null;
  const pathname = window.location.pathname;
  if (pathname && pathname !== '/login') {
    return pathname;
  }
  const params = new URLSearchParams(window.location.search);
  const redirectParam = params.get('redirect') ?? '';
  if (redirectParam.startsWith('/') && !redirectParam.startsWith('//')) {
    return redirectParam.split('?')[0] || null;
  }
  return null;
}

function findRouteMeta(path: string | null): RouteMeta | null {
  if (!path) return null;
  return (
    ALL_ROUTES.find(r => (r.href === '/' ? path === '/' : path === r.href || path.startsWith(`${r.href}/`))) ??
    null
  );
}

function pickBestIdentityForPath(
  identities: PublicIdentity[],
  targetPath: string,
  lastIdentity: PublicIdentity | null,
): PublicIdentity | null {
  if (lastIdentity && canAccessRoute(lastIdentity, targetPath)) {
    return lastIdentity;
  }
  const coreMatches = identities.filter(id => CORE_IDENTITY_NAMES.has(id.name) && canAccessRoute(id, targetPath));
  if (coreMatches.length > 0) {
    const exactDefault = coreMatches.find(id => getDefaultRouteForActor(id) === targetPath);
    return exactDefault ?? coreMatches[0];
  }
  return identities.find(id => canAccessRoute(id, targetPath)) ?? null;
}

/**
 * Isometric 3D Wireframe Power Battery Pack + 4-Org Hyperledger Fabric Topology
 * Clicking any of the 4 nodes syncs directly with the right-hand organization console.
 */
function BatteryWireframeTopology({
  selectedMsp,
  onSelectMsp,
}: {
  selectedMsp: OrganizationMSP;
  onSelectMsp: (msp: OrganizationMSP) => void;
}) {
  const isCell = selectedMsp === 'CellOrgMSP';
  const isPack = selectedMsp === 'PackOrgMSP';
  const isLab = selectedMsp === 'LabOrgMSP';
  const isRecycle = selectedMsp === 'RecycleOrgMSP';

  return (
    <div className="relative w-full max-w-[680px] select-none">
      <svg
        viewBox="0 0 680 350"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="动力电池三维线框结构与四组织区块链节点拓扑图"
      >
        <defs>
          <linearGradient id="packWireStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#7DD3FC" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="cellWireFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0F172A" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="hvBusStroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FF5722" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FB923C" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        {/* Subtle technical measurement frame & datum crosshairs */}
        <g stroke="rgba(148,163,184,0.18)" strokeWidth="1">
          <line x1="200" y1="38" x2="480" y2="38" strokeDasharray="3 4" />
          <line x1="200" y1="33" x2="200" y2="43" />
          <line x1="480" y1="33" x2="480" y2="43" />
          <line x1="172" y1="312" x2="508" y2="312" strokeDasharray="2 5" />
        </g>
        <text x="340" y="31" textAnchor="middle" fill="#64748B" fontSize="9.5" className="mono">
          CAD_REF // EV_PRISMATIC_PACK_6S2P :: GB/T 34014-2017
        </text>
        <text x="340" y="328" textAnchor="middle" fill="#64748B" fontSize="9.5" className="mono">
          BUS_SYNC // CHANNEL: batterybusiness :: ENDORSEMENT_ACTIVE
        </text>

        {/* 4 Data Bus Connections (Corners -> Pack Center) */}
        {/* Top-Left: CellOrgMSP */}
        <path
          d="M 148 72 L 196 72 L 244 120"
          fill="none"
          stroke={isCell ? '#38BDF8' : 'rgba(148,163,184,0.28)'}
          strokeWidth={isCell ? '1.8' : '1'}
        />
        {isCell && (
          <path
            d="M 148 72 L 196 72 L 244 120"
            fill="none"
            stroke="#BAE6FD"
            strokeWidth="2"
            className="wire-signal-flow"
          />
        )}

        {/* Top-Right: LabOrgMSP */}
        <path
          d="M 532 72 L 484 72 L 436 120"
          fill="none"
          stroke={isLab ? '#38BDF8' : 'rgba(148,163,184,0.28)'}
          strokeWidth={isLab ? '1.8' : '1'}
        />
        {isLab && (
          <path
            d="M 532 72 L 484 72 L 436 120"
            fill="none"
            stroke="#BAE6FD"
            strokeWidth="2"
            className="wire-signal-flow"
          />
        )}

        {/* Bottom-Left: PackOrgMSP */}
        <path
          d="M 148 272 L 196 272 L 244 224"
          fill="none"
          stroke={isPack ? '#2DD4BF' : 'rgba(148,163,184,0.28)'}
          strokeWidth={isPack ? '1.8' : '1'}
        />
        {isPack && (
          <path
            d="M 148 272 L 196 272 L 244 224"
            fill="none"
            stroke="#99F6E4"
            strokeWidth="2"
            className="wire-signal-flow"
          />
        )}

        {/* Bottom-Right: RecycleOrgMSP */}
        <path
          d="M 532 272 L 484 272 L 436 224"
          fill="none"
          stroke={isRecycle ? '#34D399' : 'rgba(148,163,184,0.28)'}
          strokeWidth={isRecycle ? '1.8' : '1'}
        />
        {isRecycle && (
          <path
            d="M 532 272 L 484 272 L 436 224"
            fill="none"
            stroke="#A7F3D0"
            strokeWidth="2"
            className="wire-signal-flow"
          />
        )}

        {/* ===== CENTRAL 3D ISOMETRIC BATTERY PACK WIREFRAME ===== */}
        <g transform="translate(0, 6)">
          {/* Lower liquid-cooled base plate */}
          <polygon
            points="340,268 188,188 340,108 492,188"
            fill="rgba(15,23,42,0.72)"
            stroke="rgba(56,189,248,0.35)"
            strokeWidth="1"
          />
          {/* Chassis outer extrusion walls */}
          <polygon
            points="188,188 340,268 340,248 188,168"
            fill="rgba(15,23,42,0.85)"
            stroke="url(#packWireStroke)"
            strokeWidth="1.2"
          />
          <polygon
            points="492,188 340,268 340,248 492,168"
            fill="rgba(12,24,42,0.9)"
            stroke="url(#packWireStroke)"
            strokeWidth="1.2"
          />
          {/* Main upper deck rim */}
          <polygon
            points="340,248 188,168 340,88 492,168"
            fill="rgba(14,32,58,0.38)"
            stroke="url(#packWireStroke)"
            strokeWidth="1.5"
          />

          {/* Left Bank: 6 Prismatic Cells in Isometric Projection */}
          {[0, 1, 2, 3, 4, 5].map(idx => {
            const dx = idx * 18;
            const dy = idx * 9.5;
            const x0 = 228 + dx;
            const y0 = 158 - dy;
            return (
              <g key={`bankL-${idx}`}>
                {/* Top face of prismatic cell */}
                <polygon
                  points={`${x0},${y0} ${x0 + 44},${y0 + 23} ${x0 + 57},${y0 + 16} ${x0 + 13},${y0 - 7}`}
                  fill="url(#cellWireFill)"
                  stroke={isCell ? '#38BDF8' : 'rgba(125,211,252,0.58)'}
                  strokeWidth={isCell ? '1.3' : '0.95'}
                />
                {/* Side wall */}
                <polygon
                  points={`${x0},${y0} ${x0 + 44},${y0 + 23} ${x0 + 44},${y0 + 36} ${x0},${y0 + 13}`}
                  fill="rgba(14,165,233,0.08)"
                  stroke="rgba(56,189,248,0.32)"
                  strokeWidth="0.75"
                />
                {/* Cell vent valve ellipse */}
                <circle cx={x0 + 28} cy={y0 + 8} r="1.5" fill={isCell ? '#38BDF8' : '#7DD3FC'} opacity="0.75" />
              </g>
            );
          })}

          {/* Right Bank: 6 Prismatic Cells in Isometric Projection */}
          {[0, 1, 2, 3, 4, 5].map(idx => {
            const dx = idx * 18;
            const dy = idx * 9.5;
            const x0 = 294 + dx;
            const y0 = 193 - dy;
            return (
              <g key={`bankR-${idx}`}>
                <polygon
                  points={`${x0},${y0} ${x0 + 44},${y0 + 23} ${x0 + 57},${y0 + 16} ${x0 + 13},${y0 - 7}`}
                  fill="url(#cellWireFill)"
                  stroke={isPack ? '#2DD4BF' : 'rgba(125,211,252,0.58)'}
                  strokeWidth={isPack ? '1.3' : '0.95'}
                />
                <polygon
                  points={`${x0},${y0} ${x0 + 44},${y0 + 23} ${x0 + 44},${y0 + 36} ${x0},${y0 + 13}`}
                  fill="rgba(45,212,191,0.07)"
                  stroke="rgba(45,212,191,0.3)"
                  strokeWidth="0.75"
                />
                <circle cx={x0 + 28} cy={y0 + 8} r="1.5" fill={isPack ? '#2DD4BF' : '#7DD3FC'} opacity="0.75" />
              </g>
            );
          })}

          {/* Central High-Voltage Busbar Spine (Industrial Warning Orange Accent) */}
          <line
            x1="286"
            y1="196"
            x2="394"
            y2="139"
            stroke="url(#hvBusStroke)"
            strokeWidth="2.4"
            strokeLinecap="square"
          />
          <circle cx="286" cy="196" r="3" fill="#FF5722" />
          <circle cx="394" cy="139" r="3" fill="#FF5722" />

          {/* Floating Upper Protective Cover Wireframe (Exploded Offset) */}
          <polygon
            points="340,218 198,144 340,70 482,144"
            fill="none"
            stroke="rgba(186,230,253,0.28)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          {/* Corner vertical datum guides */}
          <line x1="198" y1="144" x2="188" y2="168" stroke="rgba(148,163,184,0.28)" strokeWidth="0.8" strokeDasharray="2 3" />
          <line x1="482" y1="144" x2="492" y2="168" stroke="rgba(148,163,184,0.28)" strokeWidth="0.8" strokeDasharray="2 3" />
          <line x1="340" y1="70" x2="340" y2="88" stroke="rgba(148,163,184,0.35)" strokeWidth="0.8" strokeDasharray="2 3" />
          <line x1="340" y1="218" x2="340" y2="248" stroke="rgba(148,163,184,0.35)" strokeWidth="0.8" strokeDasharray="2 3" />

          {/* Precision Reticle Crosshair at Pack Center */}
          <g stroke="#38BDF8" strokeWidth="1" opacity="0.75">
            <circle cx="340" cy="168" r="14" fill="none" strokeDasharray="3 3" />
            <line x1="340" y1="148" x2="340" y2="156" />
            <line x1="340" y1="180" x2="340" y2="188" />
            <line x1="320" y1="168" x2="328" y2="168" />
            <line x1="352" y1="168" x2="360" y2="168" />
          </g>
        </g>

        {/* ===== 4 CLICKABLE CONSORTIUM NODE TERMINALS ===== */}
        {/* Node 1: CellOrgMSP (Top-Left) */}
        <g
          role="button"
          tabIndex={0}
          aria-label="选择电芯制造企业节点"
          onClick={() => onSelectMsp('CellOrgMSP')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMsp('CellOrgMSP');
            }
          }}
          className="cursor-pointer"
        >
          <polygon
            points="6,46 138,46 148,56 148,100 16,100 6,90"
            fill={isCell ? 'rgba(56,189,248,0.16)' : 'rgba(15,23,42,0.88)'}
            stroke={isCell ? '#38BDF8' : 'rgba(148,163,184,0.32)'}
            strokeWidth={isCell ? '1.5' : '1'}
          />
          <rect x="16" y="57" width="6" height="6" fill={isCell ? '#38BDF8' : '#475569'} />
          <text x="28" y="64" fill={isCell ? '#E0F2FE' : '#CBD5E1'} fontSize="11.5" fontWeight="700">
            电芯制造
          </text>
          <text x="16" y="80" fill="#7DD3FC" fontSize="9.5" className="mono">
            CellOrg :17051
          </text>
          <text x="16" y="92" fill="#94A3B8" fontSize="9">
            建档 · 供货授权
          </text>
        </g>

        {/* Node 2: LabOrgMSP (Top-Right) */}
        <g
          role="button"
          tabIndex={0}
          aria-label="选择第三方检测机构节点"
          onClick={() => onSelectMsp('LabOrgMSP')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMsp('LabOrgMSP');
            }
          }}
          className="cursor-pointer"
        >
          <polygon
            points="532,46 664,46 674,56 674,100 542,100 532,90"
            fill={isLab ? 'rgba(56,189,248,0.16)' : 'rgba(15,23,42,0.88)'}
            stroke={isLab ? '#38BDF8' : 'rgba(148,163,184,0.32)'}
            strokeWidth={isLab ? '1.5' : '1'}
          />
          <rect x="542" y="57" width="6" height="6" fill={isLab ? '#38BDF8' : '#475569'} />
          <text x="554" y="64" fill={isLab ? '#E0F2FE' : '#CBD5E1'} fontSize="11.5" fontWeight="700">
            独立检测
          </text>
          <text x="542" y="80" fill="#7DD3FC" fontSize="9.5" className="mono">
            LabOrg :21051
          </text>
          <text x="542" y="92" fill="#94A3B8" fontSize="9">
            加密质检 · 审计
          </text>
        </g>

        {/* Node 3: PackOrgMSP (Bottom-Left) */}
        <g
          role="button"
          tabIndex={0}
          aria-label="选择 PACK 装配企业节点"
          onClick={() => onSelectMsp('PackOrgMSP')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMsp('PackOrgMSP');
            }
          }}
          className="cursor-pointer"
        >
          <polygon
            points="6,244 138,244 148,254 148,298 16,298 6,288"
            fill={isPack ? 'rgba(45,212,191,0.15)' : 'rgba(15,23,42,0.88)'}
            stroke={isPack ? '#2DD4BF' : 'rgba(148,163,184,0.32)'}
            strokeWidth={isPack ? '1.5' : '1'}
          />
          <rect x="16" y="255" width="6" height="6" fill={isPack ? '#2DD4BF' : '#475569'} />
          <text x="28" y="262" fill={isPack ? '#CCFBF1' : '#CBD5E1'} fontSize="11.5" fontWeight="700">
            PACK 装配
          </text>
          <text x="16" y="278" fill="#5EEAD4" fontSize="9.5" className="mono">
            PackOrg :19051
          </text>
          <text x="16" y="290" fill="#94A3B8" fontSize="9">
            成组装配 · 放行
          </text>
        </g>

        {/* Node 4: RecycleOrgMSP (Bottom-Right) */}
        <g
          role="button"
          tabIndex={0}
          aria-label="选择退役回收企业节点"
          onClick={() => onSelectMsp('RecycleOrgMSP')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMsp('RecycleOrgMSP');
            }
          }}
          className="cursor-pointer"
        >
          <polygon
            points="532,244 664,244 674,254 674,298 542,298 532,288"
            fill={isRecycle ? 'rgba(52,211,153,0.15)' : 'rgba(15,23,42,0.88)'}
            stroke={isRecycle ? '#34D399' : 'rgba(148,163,184,0.32)'}
            strokeWidth={isRecycle ? '1.5' : '1'}
          />
          <rect x="542" y="255" width="6" height="6" fill={isRecycle ? '#34D399' : '#475569'} />
          <text x="554" y="262" fill={isRecycle ? '#D1FAE5' : '#CBD5E1'} fontSize="11.5" fontWeight="700">
            退役回收
          </text>
          <text x="542" y="278" fill="#6EE7B7" fontSize="9.5" className="mono">
            Recycle :23051
          </text>
          <text x="542" y="290" fill="#94A3B8" fontSize="9">
            签收交接 · 核销
          </text>
        </g>
      </svg>
    </div>
  );
}

export function LoginPortal() {
  const router = useRouter();
  const { identities, loading, switching, switchActor } = useIdentity();
  const { notify } = useToast();

  const [selectedMsp, setSelectedMsp] = useState<OrganizationMSP>('CellOrgMSP');
  const [selectedName, setSelectedName] = useState<string>('');
  const [roleScopeTab, setRoleScopeTab] = useState<'core' | 'all'>('core');
  const [roleFilter, setRoleFilter] = useState('');
  const [filterFocused, setFilterFocused] = useState(false);

  const [entering, setEntering] = useState(false);
  const [unlockSliding, setUnlockSliding] = useState(false);
  const [authFrameIdx, setAuthFrameIdx] = useState(0);

  const [lastActorName, setLastActorName] = useState<string | null>(null);
  const [deepLinkPath, setDeepLinkPath] = useState<string | null>(null);
  const [chainBlockHeight, setChainBlockHeight] = useState<number | null>(null);

  const initializedSelectionRef = useRef(false);
  const roleBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let active = true;
    const saved = readLastLoginActor();
    const targetPath = resolveDeepLinkPath();
    queueMicrotask(() => {
      if (!active) return;
      if (saved) setLastActorName(saved);
      if (targetPath) setDeepLinkPath(targetPath);
    });
    return () => {
      active = false;
    };
  }, []);

  // Quietly probe chain height; falls back gracefully without console noise
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/bff/dashboard', { cache: 'no-store' });
        if (!active || !res.ok) return;
        const json = (await res.json()) as {
          chain?: { blockHeight?: number };
          summary?: { blockHeight?: number };
        };
        const height = json.chain?.blockHeight ?? json.summary?.blockHeight ?? null;
        if (typeof height === 'number' && height > 0) {
          setChainBlockHeight(height);
        }
      } catch {
        // graceful fallback
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const lastIdentity = useMemo(
    () => (lastActorName ? identities.find(i => i.name === lastActorName) ?? null : null),
    [identities, lastActorName],
  );

  const deepLinkMeta = useMemo(() => findRouteMeta(deepLinkPath), [deepLinkPath]);

  useEffect(() => {
    if (initializedSelectionRef.current || identities.length === 0) return;
    initializedSelectionRef.current = true;
    if (deepLinkPath && deepLinkMeta) {
      const recommended = pickBestIdentityForPath(identities, deepLinkPath, lastIdentity);
      if (recommended) {
        queueMicrotask(() => {
          setSelectedMsp(recommended.mspId);
          setSelectedName(recommended.name);
          if (!CORE_IDENTITY_NAMES.has(recommended.name)) {
            setRoleScopeTab('all');
          }
        });
      }
    }
  }, [deepLinkMeta, deepLinkPath, identities, lastIdentity]);

  const roleCountsByMsp = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of identities) {
      counts[id.mspId] = (counts[id.mspId] ?? 0) + 1;
    }
    return counts;
  }, [identities]);

  const allOrgIdentities = useMemo(() => {
    const filtered = identities.filter(id => id.mspId === selectedMsp);
    const core = filtered.filter(id => CORE_IDENTITY_NAMES.has(id.name));
    const aux = filtered.filter(id => !CORE_IDENTITY_NAMES.has(id.name));
    return { core, aux, all: [...core, ...aux] };
  }, [identities, selectedMsp]);

  const visibleIdentities = useMemo(() => {
    const base = roleScopeTab === 'core' ? allOrgIdentities.core : allOrgIdentities.all;
    const kw = roleFilter.trim().toLowerCase();
    if (!kw) return base;
    return allOrgIdentities.all.filter(
      item =>
        item.roleLabel.toLowerCase().includes(kw) ||
        item.name.toLowerCase().includes(kw) ||
        getRoleSummaryForIdentity(item).toLowerCase().includes(kw),
    );
  }, [allOrgIdentities, roleFilter, roleScopeTab]);

  const activeSelection = useMemo(() => {
    const matched = visibleIdentities.find(id => id.name === selectedName);
    if (matched) return matched;
    return visibleIdentities[0] ?? allOrgIdentities.all[0] ?? null;
  }, [allOrgIdentities.all, selectedName, visibleIdentities]);

  const allowedRoutes = useMemo(() => getAllowedRoutes(activeSelection), [activeSelection]);
  const allowedRouteMetas = useMemo(
    () => ALL_ROUTES.filter(r => allowedRoutes.includes(r.href)),
    [allowedRoutes],
  );

  const selectedOrgProfile = useMemo(
    () => ORG_PROFILES.find(o => o.mspId === selectedMsp) ?? ORG_PROFILES[0],
    [selectedMsp],
  );
  const selectedTechMeta = ORG_TECH_META[selectedMsp];

  const defaultLandingMeta = useMemo(() => {
    if (!activeSelection) return null;
    if (deepLinkPath && canAccessRoute(activeSelection, deepLinkPath) && deepLinkMeta) {
      return deepLinkMeta;
    }
    const defHref = getDefaultRouteForActor(activeSelection);
    return ALL_ROUTES.find(r => r.href === defHref) ?? ALL_ROUTES[0];
  }, [activeSelection, deepLinkMeta, deepLinkPath]);

  const terminalLogs = useMemo(() => {
    const fp = activeSelection?.fingerprintPrefix ?? 'EE:69:FA:A0:9A:D1';
    const actorCode = activeSelection?.name ?? 'cell-manufacturer';
    const blk = chainBlockHeight ? `#${chainBlockHeight}` : '#SYNC';
    return [
      `[GB34014] VERIFY DMAPB010000001E113420837 -> TYPE:PACK CHEM:LFP CHECKSUM:OK`,
      `[MTLS_ID] SUBJECT=${actorCode} ORG=${selectedMsp} FP=${fp}`,
      `[FABRIC ] CHANNEL=batterybusiness PEER=${selectedTechMeta.nodeId}:${selectedTechMeta.port} HEIGHT=${blk}`,
      `[RISK_AI] QUALITY_IFOREST + OP_GRAPH_COLLUSION :: STATUS=ARMED (FAIL-CLOSED)`,
      `[KMS_KEY] AEAD_AES256GCM REPORT_BROKER :: ZERO_CLIENT_PRIVATE_KEY`,
      `[POLICY ] RELEASE_GATE=3_ORG_STD / 4_ORG_HIGH_RISK :: VERSION=v2`,
      `[AUDIT  ] ED25519_LOG_ANCHOR -> MERKLE_ROOT VERIFIED ON LEDGER`,
    ];
  }, [activeSelection?.fingerprintPrefix, activeSelection?.name, chainBlockHeight, selectedMsp, selectedTechMeta.nodeId, selectedTechMeta.port]);

  const selectOrganization = useCallback((msp: OrganizationMSP) => {
    setSelectedMsp(msp);
    setSelectedName('');
    setRoleFilter('');
  }, []);

  const loginWithIdentity = useCallback(
    async (target: PublicIdentity | null) => {
      if (!target || switching || loading || entering) return;
      setEntering(true);
      setAuthFrameIdx(0);
      saveLastLoginActor(target.name);

      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/login';
      const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(currentSearch);
      const redirectParam = params.get('redirect') ?? '';

      const t1 = window.setTimeout(() => setAuthFrameIdx(1), 90);
      const t2 = window.setTimeout(() => setAuthFrameIdx(2), 190);

      try {
        await switchActor(target.name, { enableRoleScope: true });
        setAuthFrameIdx(3);
        setUnlockSliding(true);
        notify({
          tone: 'success',
          title: `身份已核验：${target.roleLabel}`,
          description: `${target.orgLabel.split(' ')[0]} · 正在解锁工作台`,
        });

        window.setTimeout(() => {
          if (currentPath !== '/login' && canAccessRoute(target, currentPath)) {
            setEntering(false);
            setUnlockSliding(false);
            return;
          }
          if (redirectParam.startsWith('/') && !redirectParam.startsWith('//')) {
            const targetPath = redirectParam.split('?')[0];
            if (canAccessRoute(target, targetPath)) {
              router.push(redirectParam);
              return;
            }
          }
          router.push(getDefaultRouteForActor(target));
        }, 280);
      } catch {
        setEntering(false);
        setUnlockSliding(false);
      } finally {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      }
    },
    [entering, loading, notify, router, switchActor, switching],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') return;
      if (activeSelection && !switching && !loading && !entering) {
        e.preventDefault();
        void loginWithIdentity(activeSelection);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSelection, entering, loading, loginWithIdentity, switching]);

  function handleRoleKeyDown(e: React.KeyboardEvent, idx: number) {
    const len = visibleIdentities.length;
    if (len === 0) return;
    let nextIdx = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIdx = (idx + 1) % len;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIdx = (idx - 1 + len) % len;
    if (nextIdx >= 0) {
      e.preventDefault();
      setSelectedName(visibleIdentities[nextIdx].name);
      roleBtnRefs.current[nextIdx]?.focus();
    }
  }

  return (
    <div className="relative grid min-h-screen w-full grid-cols-1 overflow-x-hidden bg-[#0b1424] lg:grid-cols-[60%_40%]">
      {/* =================================================================== */}
      {/* LEFT (60% Desktop / Compact Header Mobile): Matte Navy Command Deck */}
      {/* =================================================================== */}
      <section className="industrial-navy-deck relative flex flex-col justify-between overflow-hidden px-5 py-4 text-slate-100 lg:border-r lg:border-[#040914] lg:px-10 lg:py-7 lg:shadow-[inset_-1px_0_0_rgba(148,163,184,0.28)]">
        {/* Matte anodized aluminum micro-noise overlay */}
        <div aria-hidden="true" className="industrial-matte-noise pointer-events-none absolute inset-0" />

        {/* Corner Precision Reticles & Engineering Scale Ticks (Desktop) */}
        <div aria-hidden="true" className="pointer-events-none absolute top-4 left-4 hidden text-sky-400/45 lg:block">
          <div className="h-3 w-3 border-t border-l border-sky-400/55" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute top-4 right-5 hidden text-sky-400/45 lg:block">
          <div className="h-3 w-3 border-t border-r border-sky-400/55" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-4 left-4 hidden text-sky-400/45 lg:block">
          <div className="h-3 w-3 border-b border-l border-sky-400/55" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute right-5 bottom-4 hidden text-sky-400/45 lg:block">
          <div className="h-3 w-3 border-b border-r border-sky-400/55" />
        </div>

        {/* Left vertical engineering coordinate ruler */}
        <div
          aria-hidden="true"
          className="mono pointer-events-none absolute top-1/2 left-3 hidden -translate-y-1/2 flex-col items-center gap-3 text-[9px] text-slate-500/75 xl:flex"
        >
          <span>⌖</span>
          <span className="h-10 w-px bg-slate-600/40" />
          <span style={{ writingMode: 'vertical-rl' }} className="tracking-[0.2em]">
            SYS_AUTH // {selectedTechMeta.code}
          </span>
          <span className="h-10 w-px bg-slate-600/40" />
          <span>⌖</span>
        </div>

        {/* Top Telemetry Strip + Official Logo Lockup */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-slate-700/55 pb-3.5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-mark.png"
              alt="智权链·锂安溯 官方徽标"
              width={44}
              height={44}
              className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_4px_12px_rgba(56,189,248,0.28)] select-none lg:h-11 lg:w-11"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-wider text-white lg:text-lg">智权链 · 锂安溯</h1>
                <span className="mono hidden border border-sky-400/35 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 sm:inline-block">
                  V2.1
                </span>
              </div>
              <p className="mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">
                TRUSTGUARD BATTERY // SYS_AUTH
              </p>
            </div>
          </div>

          {/* Focused LED Status Indicator */}
          <div className="flex items-center gap-2.5 border border-slate-700/75 bg-[#08101e] px-3 py-1.5">
            <span className="h-2 w-2 bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span className="mono text-[10.5px] font-medium text-slate-200">
              {chainBlockHeight ? `LEDGER #${chainBlockHeight}` : 'FABRIC_4ORG // ONLINE'}
            </span>
          </div>
        </div>

        {/* Centerpiece (Desktop): Engineering Spec Header + 3D Wireframe Battery Pack & 4-Org Topology */}
        <div className="relative z-10 my-auto hidden flex-col items-center py-4 lg:flex">
          <div className="mb-3 flex w-full max-w-[680px] items-end justify-between border-l-2 border-sky-400 pl-3.5">
            <div>
              <div className="mono text-[10.5px] tracking-[0.14em] text-sky-400 uppercase">
                POWER BATTERY LIFECYCLE & ACTIVE SECURITY CONSOLE
              </div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-white xl:text-[26px]">
                动力电池全生命周期可信溯源与主动安全控制台
              </h2>
            </div>
            <div className="mono hidden text-right text-[10px] leading-relaxed text-slate-400 xl:block">
              <div>FOCUS: {selectedTechMeta.nodeId}</div>
              <div className="text-sky-300">{`PORT :${selectedTechMeta.port} // ACTIVE`}</div>
            </div>
          </div>

          <BatteryWireframeTopology selectedMsp={selectedMsp} onSelectMsp={selectOrganization} />

          {/* 4-Metric Precision Hardware Readout Bar */}
          <div className="mt-3 grid w-full max-w-[680px] grid-cols-4 border border-slate-700/65 bg-[#08101e]/90">
            <div className="border-r border-slate-700/65 px-3 py-2">
              <div className="mono text-[9.5px] text-slate-400">STD_SPEC</div>
              <div className="mono mt-0.5 text-xs font-semibold text-slate-100">GB/T 34014</div>
            </div>
            <div className="border-r border-slate-700/65 px-3 py-2">
              <div className="mono text-[9.5px] text-slate-400">CONSORTIUM</div>
              <div className="mono mt-0.5 text-xs font-semibold text-sky-300">4 ORG / 28 ID</div>
            </div>
            <div className="border-r border-slate-700/65 px-3 py-2">
              <div className="mono text-[9.5px] text-slate-400">AUTH_VAULT</div>
              <div className="mono mt-0.5 text-xs font-semibold text-emerald-300">ZERO_PRIVKEY</div>
            </div>
            <div className="px-3 py-2">
              <div className="mono text-[9.5px] text-slate-400">RISK_GATE</div>
              <div className="mono mt-0.5 text-xs font-semibold text-[#FF7A45]">FAIL-CLOSED</div>
            </div>
          </div>
        </div>

        {/* Bottom (Desktop): Quietly Scrolling Monospace Verification Terminal Stream */}
        <div className="relative z-10 hidden flex-col gap-2 lg:flex">
          <div className="border border-slate-700/70 bg-[#060d18]/95 px-3.5 py-2.5">
            <div className="mb-1.5 flex items-center justify-between border-b border-slate-800 pb-1.5">
              <div className="mono flex items-center gap-1.5 text-[10px] font-semibold text-sky-400">
                <Terminal className="h-3 w-3" />
                <span>KERNEL_VERIFY_STREAM // REALTIME TELEMETRY</span>
              </div>
              <span className="mono text-[9.5px] text-slate-500">⌖ AUTO_CHECK :: ACTIVE</span>
            </div>
            <div
              className="relative h-[56px] overflow-hidden"
              style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)',
              }}
            >
              <div className="animate-terminal-stream mono space-y-1 text-[10.5px] leading-[17px] text-slate-400">
                {[...terminalLogs, ...terminalLogs].map((line, idx) => (
                  <div key={idx} className="truncate">
                    <span className="mr-1.5 text-sky-500/80">&gt;</span>
                    <span className={line.includes('RISK_AI') ? 'text-[#FF8A65]' : line.includes('MTLS_ID') ? 'text-sky-300' : 'text-slate-300/90'}>
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mono flex items-center justify-between text-[10px] text-slate-500">
            <span>© 2026 TRUSTGUARD_BATTERY // 智权链·锂安溯</span>
            <span>HYPERLEDGER FABRIC 2.5 :: TLS_MUTUAL</span>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* RIGHT (40% Desktop): Cold Lab Slate Operations Bay (Mechanical Gate) */}
      {/* =================================================================== */}
      <section
        className={`industrial-lab-bay relative flex flex-col justify-between border-t border-slate-300 px-5 py-5 text-slate-900 transition-transform duration-300 ease-in-out sm:px-7 lg:border-t-0 lg:border-l lg:border-[#b9c7d8] lg:px-8 lg:py-7 ${
          unlockSliding ? 'translate-x-full opacity-90' : 'translate-x-0 opacity-100'
        }`}
      >
        {/* Top Metallic Rivet / Calibration Line */}
        <div className="mx-auto flex w-full max-w-[490px] flex-1 flex-col justify-between gap-4">
          {/* Header Block */}
          <div>
            <div className="flex items-center justify-between border-b border-slate-300/90 pb-3">
              <div>
                <div className="mono flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">
                  <span className="inline-block h-1.5 w-1.5 bg-[#0284C7]" />
                  <span>OPERATOR_BAY // 身份接入终端</span>
                </div>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-[#0F172A]">选择机构与作业岗位</h2>
              </div>

              {lastIdentity && (
                <button
                  type="button"
                  disabled={switching || loading || entering}
                  onClick={() => void loginWithIdentity(lastIdentity)}
                  className="chamfer-sm inline-flex cursor-pointer items-center gap-1.5 border border-[#0284C7]/40 bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#0369A1] transition duration-150 hover:border-[#0284C7] hover:bg-[#0284C7] hover:text-white disabled:opacity-50"
                >
                  <History className="h-3 w-3" />
                  <span className="max-w-[130px] truncate">上次：{lastIdentity.roleLabel}</span>
                </button>
              )}
            </div>

            {/* Deep-link Warning/Direct-Route Bar (Industrial Orange Accent) */}
            {deepLinkMeta && (
              <div className="mt-3 flex items-start gap-2 border-l-[3px] border-[#FF5722] bg-[#FFF4F0] px-3 py-2 text-xs text-[#7C2D12]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF5722]" />
                <div className="leading-relaxed">
                  <span className="mono mr-1.5 font-bold text-[#FF5722]">[REDIRECT]</span>
                  目标页面为<strong>「{deepLinkMeta.label}」</strong>，已自动锁定有权限的作业岗位。
                </div>
              </div>
            )}
          </div>

          {/* MODULE 01: Organization Selector Matrix (Hard-edge interlocked tiles) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="mono text-[11px] font-bold tracking-wide text-slate-700">
                01 // 所属联盟机构
              </span>
              <span className="mono text-[10.5px] font-semibold text-[#0369A1]">
                {selectedOrgProfile.mspId} :{selectedTechMeta.port}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {ORG_PROFILES.map(org => {
                const active = selectedMsp === org.mspId;
                const tech = ORG_TECH_META[org.mspId];
                const count = roleCountsByMsp[org.mspId] ?? 0;
                return (
                  <button
                    key={org.mspId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectOrganization(org.mspId)}
                    className={`chamfer-sm relative flex cursor-pointer flex-col justify-between border px-3 py-2.5 text-left transition duration-150 ${
                      active
                        ? 'border-[#0284C7] bg-[#0F172A] text-white shadow-[inset_3px_0_0_#38BDF8]'
                        : 'border-slate-300 bg-white/90 text-slate-800 hover:border-[#0284C7]/60 hover:bg-white'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        {active && (
                          <span className="animate-cursor-block inline-block h-2 w-2 bg-[#38BDF8]" />
                        )}
                        <span className="truncate">{org.shortName}</span>
                      </span>
                      <span
                        className={`mono text-[10px] font-semibold ${
                          active ? 'text-sky-300' : 'text-slate-500'
                        }`}
                      >
                        {count}G
                      </span>
                    </div>
                    <div
                      className={`mono mt-1 flex items-center justify-between text-[10px] ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      <span>{tech.code}</span>
                      <span>:{tech.port}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-1.5 border border-slate-300/80 bg-white/70 px-3 py-1.5 text-[11.5px] leading-snug text-slate-600">
              <span className="mono mr-1.5 font-bold text-[#0F172A]">SCOPE:</span>
              {selectedOrgProfile.tagline}
            </div>
          </div>

          {/* MODULE 02: Role Selection + Precision Terminal Filter Input */}
          <div className="flex flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="mono text-[11px] font-bold tracking-wide text-slate-700">
                02 // 作业岗位认证
              </span>

              <div role="tablist" aria-label="岗位筛选" className="inline-flex border border-slate-300 bg-white">
                <button
                  type="button"
                  role="tab"
                  aria-selected={roleScopeTab === 'core'}
                  onClick={() => {
                    setRoleScopeTab('core');
                    setRoleFilter('');
                  }}
                  className={`mono cursor-pointer px-2.5 py-1 text-[10.5px] font-bold transition duration-150 ${
                    roleScopeTab === 'core'
                      ? 'bg-[#0F172A] text-[#38BDF8]'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  核心 ({allOrgIdentities.core.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={roleScopeTab === 'all'}
                  onClick={() => setRoleScopeTab('all')}
                  className={`mono cursor-pointer border-l border-slate-300 px-2.5 py-1 text-[10.5px] font-bold transition duration-150 ${
                    roleScopeTab === 'all'
                      ? 'bg-[#0F172A] text-[#38BDF8]'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  全部 ({allOrgIdentities.all.length})
                </button>
              </div>
            </div>

            {/* Mechanical Terminal Filter Input (0.15s crisp border + blinking ■ block on focus) */}
            <div
              className={`mb-2 flex items-center gap-2 border bg-white px-2.5 py-1.5 transition duration-150 ${
                filterFocused
                  ? 'border-[#0284C7] shadow-[inset_3px_0_0_#38BDF8]'
                  : 'border-slate-300'
              }`}
            >
              {filterFocused ? (
                <span className="animate-cursor-block inline-block h-2.5 w-2.5 shrink-0 bg-[#0284C7]" />
              ) : (
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              )}
              <input
                type="text"
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                onFocus={() => setFilterFocused(true)}
                onBlur={() => setFilterFocused(false)}
                placeholder="输入岗位名称或职责快速定位（如：审批、质检、装配）"
                aria-label="筛选岗位"
                className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              {roleFilter && (
                <button
                  type="button"
                  onClick={() => setRoleFilter('')}
                  className="mono cursor-pointer text-[10px] font-bold text-slate-500 hover:text-[#FF5722]"
                >
                  CLR
                </button>
              )}
            </div>

            {/* Role List */}
            <div className="max-h-[306px] space-y-1.5 overflow-y-auto pr-0.5 lg:min-h-[246px]">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton-block h-[60px] rounded-none" />
                ))
              ) : visibleIdentities.length === 0 ? (
                <div className="border border-dashed border-[#FF5722]/60 bg-[#FFF4F0] px-3 py-4 text-center text-xs text-[#9A3412]">
                  未匹配到「{roleFilter}」相关岗位，请清空条件或切换其他企业。
                </div>
              ) : (
                visibleIdentities.map((item, idx) => {
                  const selected = activeSelection?.name === item.name;
                  const isCore = CORE_IDENTITY_NAMES.has(item.name);
                  const RoleIcon = ROLE_ICONS[item.role] ?? UserCheck;
                  return (
                    <button
                      key={item.name}
                      ref={el => {
                        roleBtnRefs.current[idx] = el;
                      }}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedName(item.name)}
                      onDoubleClick={() => {
                        setSelectedName(item.name);
                        void loginWithIdentity(item);
                      }}
                      onKeyDown={e => handleRoleKeyDown(e, idx)}
                      className={`group flex w-full cursor-pointer items-center gap-3 border px-3 py-2.5 text-left transition duration-150 ${
                        selected
                          ? 'border-[#0284C7] bg-[#0F172A] text-white shadow-[inset_3px_0_0_#38BDF8]'
                          : 'border-slate-300 bg-white/95 text-slate-800 hover:border-[#0284C7]/65 hover:bg-white'
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center border ${
                          selected
                            ? 'border-sky-400/50 bg-sky-500/15 text-[#38BDF8]'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        <RoleIcon className="h-3.5 w-3.5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {selected && (
                              <span className="animate-cursor-block inline-block h-2 w-2 shrink-0 bg-[#38BDF8]" />
                            )}
                            <span className="truncate text-[13px] font-bold">{item.roleLabel}</span>
                            {roleScopeTab === 'all' && isCore && (
                              <span
                                className={`mono shrink-0 px-1 py-0.5 text-[9.5px] font-bold ${
                                  selected
                                    ? 'bg-sky-400/20 text-sky-300'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                CORE
                              </span>
                            )}
                          </div>
                          <span
                            className={`mono shrink-0 text-[10px] ${
                              selected ? 'text-sky-300' : 'text-slate-400'
                            }`}
                          >
                            {selected && defaultLandingMeta ? `→ ${defaultLandingMeta.label}` : item.role.toUpperCase()}
                          </span>
                        </div>
                        <p
                          className={`mt-0.5 truncate text-[11.5px] ${
                            selected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {getRoleSummaryForIdentity(item)}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* MODULE 03: mTLS Hardware Credential Readout + Chamfered Trigger Button */}
          <div className="sticky bottom-0 z-20 -mx-5 border-t border-slate-300 bg-[#edf2f7]/95 px-5 pt-3 pb-1 backdrop-blur-sm sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pt-3 sm:pb-0">
            {activeSelection && (
              <div className="mb-2.5 border border-slate-300 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 pb-1.5">
                  <div className="mono flex min-w-0 items-center gap-1.5 text-[11px]">
                    <span className="inline-block h-2 w-2 bg-emerald-500" />
                    <strong className="truncate text-[#0F172A]">{activeSelection.roleLabel}</strong>
                    <span className="text-slate-400">/</span>
                    <span className="text-slate-600">{activeSelection.fingerprintPrefix}</span>
                  </div>
                  <span className="mono inline-flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                    <Lock className="h-2.5 w-2.5 text-[#0284C7]" />
                    SERVER_CUSTODY
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="可访问工作台模块">
                  <span className="mono mr-1 text-[10px] font-semibold text-slate-500">ACCESS:</span>
                  {allowedRouteMetas.slice(0, 4).map(r => (
                    <span
                      key={r.href}
                      className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-700"
                    >
                      {r.label}
                    </span>
                  ))}
                  {allowedRouteMetas.length > 4 && (
                    <span
                      title={allowedRouteMetas.map(r => r.label).join('、')}
                      className="mono border border-[#0284C7]/35 bg-[#E0F2FE] px-1.5 py-0.5 text-[10px] font-bold text-[#0369A1]"
                    >
                      +{allowedRouteMetas.length - 4}
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={switching || loading || entering || !activeSelection}
              onClick={() => void loginWithIdentity(activeSelection)}
              className="chamfer-btn led-btn-primary group relative inline-flex w-full cursor-pointer items-center justify-center gap-2.5 bg-[#0F172A] px-6 py-3.5 text-sm font-bold tracking-wide text-white shadow-[inset_0_1px_0_rgba(56,189,248,0.65)] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {entering || switching ? (
                <span className="mono text-xs tracking-wider text-[#38BDF8]">
                  {AUTH_PROGRESS_FRAMES[authFrameIdx] ?? AUTH_PROGRESS_FRAMES[0]}
                </span>
              ) : (
                <>
                  <span className="h-2 w-2 bg-[#38BDF8] shadow-[0_0_6px_#38BDF8]" />
                  <span>
                    {defaultLandingMeta
                      ? `接入工作台 · 进入「${defaultLandingMeta.label}」`
                      : '确认身份接入工作台'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#38BDF8] transition-transform duration-150 group-hover:translate-x-1" />
                  <kbd className="mono ml-1 hidden border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 sm:inline-block">
                    ENTER ↵
                  </kbd>
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPortal />;
}
