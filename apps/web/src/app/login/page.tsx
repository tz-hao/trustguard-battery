'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Compass,
  Eye,
  Factory,
  FileCheck2,
  Fingerprint,
  History,
  Layers,
  Loader2,
  Lock,
  Microscope,
  Recycle,
  Settings2,
  ShieldCheck,
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

const ORG_VISUALS: Record<
  OrganizationMSP,
  {
    image: string;
    activeRing: string;
    topBar: string;
    badgeTone: string;
    nodeLabel: string;
    nodeDuty: string;
    nodeGlow: string;
    nodeDot: string;
  }
> = {
  CellOrgMSP: {
    image: '/visuals/org-cell.jpg',
    activeRing: 'border-brand ring-2 ring-brand/20 shadow-md shadow-brand/10',
    topBar: 'bg-brand',
    badgeTone: 'text-brand',
    nodeLabel: '电芯制造',
    nodeDuty: '原料建档与供货授权',
    nodeGlow: 'border-sky-400/75 bg-sky-500/15 shadow-[0_0_24px_rgba(56,189,248,0.28)]',
    nodeDot: 'bg-sky-400',
  },
  PackOrgMSP: {
    image: '/visuals/org-pack.jpg',
    activeRing: 'border-teal ring-2 ring-teal/20 shadow-md shadow-teal/10',
    topBar: 'bg-teal',
    badgeTone: 'text-teal',
    nodeLabel: '成组装配',
    nodeDuty: '模组成组与放行交接',
    nodeGlow: 'border-teal-400/75 bg-teal-500/15 shadow-[0_0_24px_rgba(45,212,191,0.28)]',
    nodeDot: 'bg-teal-400',
  },
  LabOrgMSP: {
    image: '/visuals/org-lab.jpg',
    activeRing: 'border-info ring-2 ring-info/20 shadow-md shadow-info/10',
    topBar: 'bg-info',
    badgeTone: 'text-[#1d5fa3]',
    nodeLabel: '独立检测',
    nodeDuty: '加密质检与独立复核',
    nodeGlow: 'border-blue-400/75 bg-blue-500/15 shadow-[0_0_24px_rgba(96,165,250,0.28)]',
    nodeDot: 'bg-blue-400',
  },
  RecycleOrgMSP: {
    image: '/visuals/org-recycle.jpg',
    activeRing: 'border-success ring-2 ring-success/20 shadow-md shadow-success/10',
    topBar: 'bg-success',
    badgeTone: 'text-success',
    nodeLabel: '退役回收',
    nodeDuty: '回收签收与报废核销',
    nodeGlow: 'border-emerald-400/75 bg-emerald-500/15 shadow-[0_0_24px_rgba(52,211,153,0.28)]',
    nodeDot: 'bg-emerald-400',
  },
};

const CONSORTIUM_ORDER: OrganizationMSP[] = [
  'CellOrgMSP',
  'LabOrgMSP',
  'PackOrgMSP',
  'RecycleOrgMSP',
];

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
    // Prefer a role whose default landing page matches the target path
    const exactDefault = coreMatches.find(id => getDefaultRouteForActor(id) === targetPath);
    return exactDefault ?? coreMatches[0];
  }
  return identities.find(id => canAccessRoute(id, targetPath)) ?? null;
}

export function LoginPortal() {
  const router = useRouter();
  const { identities, loading, switching, switchActor } = useIdentity();
  const { notify } = useToast();

  const [selectedMsp, setSelectedMsp] = useState<OrganizationMSP>('CellOrgMSP');
  const [selectedName, setSelectedName] = useState<string>('');
  const [roleScopeTab, setRoleScopeTab] = useState<'core' | 'all'>('core');
  const [entering, setEntering] = useState(false);
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

  // Quietly probe public block height if available; never blocks login or logs errors
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
        // graceful static fallback
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

  // Auto pre-select an authorized identity when arriving via a deep link (runs once after identities load)
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

  const visibleIdentities = useMemo(
    () => (roleScopeTab === 'core' ? allOrgIdentities.core : allOrgIdentities.all),
    [allOrgIdentities, roleScopeTab],
  );

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

  const defaultLandingMeta = useMemo(() => {
    if (!activeSelection) return null;
    if (deepLinkPath && canAccessRoute(activeSelection, deepLinkPath) && deepLinkMeta) {
      return deepLinkMeta;
    }
    const defHref = getDefaultRouteForActor(activeSelection);
    return ALL_ROUTES.find(r => r.href === defHref) ?? ALL_ROUTES[0];
  }, [activeSelection, deepLinkMeta, deepLinkPath]);

  const selectOrganization = useCallback((msp: OrganizationMSP) => {
    setSelectedMsp(msp);
    setSelectedName('');
  }, []);

  const loginWithIdentity = useCallback(
    async (target: PublicIdentity | null) => {
      if (!target || switching || loading || entering) return;
      setEntering(true);
      saveLastLoginActor(target.name);
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/login';
      const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(currentSearch);
      const redirectParam = params.get('redirect') ?? '';

      await switchActor(target.name, { enableRoleScope: true });
      notify({
        tone: 'success',
        title: `欢迎回来，${target.roleLabel}`,
        description: `${target.orgLabel.split(' ')[0]} · 已进入专属工作台`,
      });
      window.setTimeout(() => {
        if (currentPath !== '/login' && canAccessRoute(target, currentPath)) {
          setEntering(false);
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
      }, 160);
    },
    [entering, loading, notify, router, switchActor, switching],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') return;
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
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % len;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + len) % len;
    else if (e.key === 'ArrowDown') nextIdx = (idx + 2) % len;
    else if (e.key === 'ArrowUp') nextIdx = (idx - 2 + len) % len;
    if (nextIdx >= 0) {
      e.preventDefault();
      setSelectedName(visibleIdentities[nextIdx].name);
      roleBtnRefs.current[nextIdx]?.focus();
    }
  }

  const visibleModulePills = allowedRouteMetas.slice(0, 4);
  const extraModuleCount = Math.max(0, allowedRouteMetas.length - visibleModulePills.length);

  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-white lg:grid-cols-[50%_50%] xl:grid-cols-[52%_48%]">
      {/* LEFT: Deep-Navy Digital-Twin Consortium Showcase (Compact Top Bar on Mobile) */}
      <section className="login-showcase-canvas relative flex flex-col justify-between overflow-hidden px-5 py-4 text-white lg:border-r lg:border-sky-400/15 lg:px-10 lg:py-8 xl:px-12">
        {/* Ambient radial accent glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-24 hidden h-80 w-80 rounded-full bg-brand/20 blur-3xl lg:block"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 hidden h-80 w-80 rounded-full bg-teal/20 blur-3xl lg:block"
        />

        {/* Top Brand Lockup + Live Channel Pill */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-mark.png"
              alt="智权链·锂安溯 官方徽标"
              width={44}
              height={44}
              className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_6px_16px_rgba(14,165,233,0.35)] select-none lg:h-11 lg:w-11"
            />
            <div>
              <h1 className="text-base font-bold tracking-wide text-white lg:text-lg">智权链 · 锂安溯</h1>
              <p className="mono text-[10px] font-medium tracking-[0.16em] text-sky-300/85 uppercase">
                TrustGuard Battery
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-200 backdrop-blur-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            <span className="hidden sm:inline">
              {chainBlockHeight ? `Fabric 通道在线 · 区块 #${chainBlockHeight}` : 'Fabric 联盟链 · 四组织共治'}
            </span>
            <span className="sm:hidden">4 组织 · 28 身份</span>
          </div>
        </div>

        {/* Desktop Centerpiece: Headline + Blended 3D Digital-Twin Visual */}
        <div
          className={`relative z-10 my-auto hidden flex-col items-center py-6 text-center transition-all duration-300 lg:flex ${
            entering ? 'scale-105 opacity-0' : 'scale-100 opacity-100'
          }`}
        >
          <div className="max-w-lg">
            <h2 className="text-2xl leading-snug font-bold tracking-tight text-white xl:text-[28px]">
              动力电池全生命周期
              <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent">
                可信溯源与主动安全
              </span>
            </h2>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-300/90 xl:text-[13px]">
              严格遵循 GB/T 34014 编码规范，以四组织多方背书、加密质检与智能风控守护从电芯制造到退役回收的每一笔账本记录。
            </p>
          </div>

          {/* Seamless 3D Digital Twin Battery Pack Visual */}
          <div className="animate-logo-float relative mt-5 w-full max-w-[520px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-6 rounded-full bg-gradient-to-tr from-brand/25 via-sky-400/15 to-teal/25 blur-3xl"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/visuals/login-hero.jpg"
              alt="动力电池数字孪生与四组织联盟链防护视觉图"
              width={1376}
              height={768}
              className="login-hero-blend relative mx-auto aspect-[16/9] w-full object-cover select-none"
            />
          </div>
        </div>

        {/* Desktop Bottom: Interactive 4-Node Consortium Rail (Synced with Selected Org) */}
        <div className="relative z-10 hidden flex-col gap-4 lg:flex">
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-medium text-slate-300">联盟共识节点拓扑（点击可切换左侧高亮与右侧企业）</span>
              <span className="mono text-sky-300/90">
                当前聚焦：{selectedOrgProfile.shortName} · {selectedOrgProfile.peerPort}
              </span>
            </div>

            <div className="relative grid grid-cols-4 gap-2.5">
              {/* Connecting subtle rail behind nodes */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-6 left-6 h-px -translate-y-1/2 bg-gradient-to-r from-sky-500/20 via-teal-400/35 to-emerald-400/20"
              />
              {CONSORTIUM_ORDER.map(msp => {
                const org = ORG_PROFILES.find(o => o.mspId === msp)!;
                const visual = ORG_VISUALS[msp];
                const isActive = selectedMsp === msp;
                return (
                  <button
                    key={msp}
                    type="button"
                    onClick={() => selectOrganization(msp)}
                    className={`relative flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 text-left transition duration-200 backdrop-blur-sm ${
                      isActive
                        ? visual.nodeGlow
                        : 'border-white/10 bg-[#0a1a2f]/80 hover:border-sky-400/35 hover:bg-[#0e233e]/85'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-white">{visual.nodeLabel}</span>
                      <span
                        className={`h-2 w-2 rounded-full transition ${
                          isActive ? `${visual.nodeDot} ring-4 ring-white/15` : 'bg-slate-600'
                        }`}
                      />
                    </div>
                    <span className="mono mt-0.5 text-[10px] text-sky-300/80">{org.peerPort}</span>
                    <span className="mt-1 truncate text-[10.5px] text-slate-300/85">{visual.nodeDuty}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-slate-400">
            <span>© 2026 智权链·锂安溯 · TrustGuard Battery</span>
            <span className="mono">GB/T 34014—2017 · Fabric 2.5</span>
          </div>
        </div>
      </section>

      {/* RIGHT: Refined Enterprise & Role Selection Workspace */}
      <section className="flex flex-col justify-between bg-white px-5 py-5 sm:px-8 lg:px-10 lg:py-7">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
          {/* Deep-Link Welcome Banner (Shown when arriving at a specific module or asset link) */}
          {deepLinkMeta && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-brand/25 bg-brand/[0.06] px-3.5 py-2.5 text-xs text-navy-900">
              <Compass className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <div className="min-w-0 leading-relaxed">
                <span>正在前往</span>
                <strong className="mx-1 font-bold text-brand">「{deepLinkMeta.label}」</strong>
                <span className="text-ink-secondary">
                  ，已为您预选具备查看权限的岗位，登录成功后自动直达目标页面。
                </span>
              </div>
            </div>
          )}

          {/* Header + Remember Last Login Quick Entry */}
          <div className="flex flex-wrap items-end justify-between gap-2 pb-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-navy-950 sm:text-2xl">选择身份登录</h2>
              <p className="mt-0.5 text-xs text-ink-secondary">按所属联盟企业与工作岗位切换服务端托管身份</p>
            </div>

            {lastIdentity && (
              <button
                type="button"
                disabled={switching || loading || entering}
                onClick={() => void loginWithIdentity(lastIdentity)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brand/25 bg-brand/[0.06] px-3 py-1 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white disabled:opacity-50"
              >
                <History className="h-3.5 w-3.5" />
                <span>
                  上次：{lastIdentity.roleLabel} · {lastIdentity.orgLabel.split(' ')[0]}
                </span>
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Step 1: Select Organization — 4 Illustrated 3D Scene Enterprise Cards */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-navy-900">
                <span className="mono flex h-5 w-5 items-center justify-center rounded-md bg-brand text-[11px] text-white">
                  1
                </span>
                <Building2 className="h-3.5 w-3.5 text-brand" />
                <span>选择所属企业</span>
              </div>
              <span className="mono text-[11px] font-medium text-ink-secondary">
                {selectedOrgProfile.mspId} · {selectedOrgProfile.peerPort}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {ORG_PROFILES.map(org => {
                const active = selectedMsp === org.mspId;
                const visual = ORG_VISUALS[org.mspId];
                const count = roleCountsByMsp[org.mspId] ?? 0;
                return (
                  <button
                    key={org.mspId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectOrganization(org.mspId)}
                    className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-left transition duration-150 ${
                      active
                        ? visual.activeRing
                        : 'border-line hover:border-brand/40 hover:shadow-sm'
                    }`}
                  >
                    {/* Top brand accent bar on active card */}
                    <span
                      className={`absolute top-0 right-0 left-0 z-10 h-[3px] transition-opacity duration-200 ${
                        active ? `${visual.topBar} opacity-100` : 'opacity-0'
                      }`}
                    />

                    {/* 3D Industrial Scene Visual */}
                    <div className="relative h-16 w-full overflow-hidden bg-[#060f1d] sm:h-[68px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={visual.image}
                        alt={org.shortName}
                        className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-105 select-none"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060f1d]/70 via-transparent to-transparent" />
                      {count > 0 && (
                        <span className="mono absolute top-1.5 right-1.5 rounded-full border border-white/20 bg-[#061224]/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs backdrop-blur-xs">
                          {count} 岗
                        </span>
                      )}
                      {active && (
                        <CheckCircle2 className="absolute top-1.5 left-1.5 h-4 w-4 rounded-full bg-white text-brand shadow-xs" />
                      )}
                    </div>

                    {/* Enterprise Name */}
                    <div className="px-2 py-2 text-center">
                      <div
                        className={`truncate text-xs font-bold ${
                          active ? visual.badgeTone : 'text-ink'
                        }`}
                      >
                        {org.shortName}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Enterprise Scope Strip */}
            <div className="mt-2 rounded-xl border border-line/70 bg-canvas/80 px-3.5 py-2 text-xs leading-relaxed text-ink-secondary">
              <strong className="font-semibold text-ink">{selectedOrgProfile.shortName}：</strong>
              <span>{selectedOrgProfile.tagline}</span>
            </div>
          </div>

          {/* Step 2: Select Role — Core / All Segmented Toggle */}
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-navy-900">
                <span className="mono flex h-5 w-5 items-center justify-center rounded-md bg-teal text-[11px] text-white">
                  2
                </span>
                <UserCheck className="h-3.5 w-3.5 text-teal" />
                <span>选择登录岗位</span>
              </div>

              {/* Segmented Filter: Core Practical Roles vs All Roles */}
              <div
                role="tablist"
                aria-label="岗位筛选"
                className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-[11px]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={roleScopeTab === 'core'}
                  onClick={() => setRoleScopeTab('core')}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-semibold transition ${
                    roleScopeTab === 'core'
                      ? 'bg-white text-navy-950 shadow-xs'
                      : 'text-ink-secondary hover:text-ink'
                  }`}
                >
                  核心实战岗 ({allOrgIdentities.core.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={roleScopeTab === 'all'}
                  onClick={() => setRoleScopeTab('all')}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-semibold transition ${
                    roleScopeTab === 'all'
                      ? 'bg-white text-navy-950 shadow-xs'
                      : 'text-ink-secondary hover:text-ink'
                  }`}
                >
                  全部岗位 ({allOrgIdentities.all.length})
                </button>
              </div>
            </div>

            <div className="flex flex-col justify-start lg:min-h-[246px]">
              {loading ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton-block h-[86px]" />
                  ))}
                </div>
              ) : (
                <div aria-label="岗位列表" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {visibleIdentities.map((item, idx) => {
                    const selected = activeSelection?.name === item.name;
                    const isCore = CORE_IDENTITY_NAMES.has(item.name);
                    const RoleIcon = ROLE_ICONS[item.role] ?? UserCheck;
                    const spanFull = visibleIdentities.length % 2 === 1 && idx === visibleIdentities.length - 1;
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
                        className={`flex min-h-[82px] cursor-pointer flex-col items-start justify-start rounded-2xl border p-3 text-left transition duration-150 ${
                          spanFull ? 'sm:col-span-2' : ''
                        } ${
                          selected
                            ? 'border-navy-900 bg-gradient-to-br from-[#0e223a] to-[#173558] text-white shadow-md shadow-navy-950/20'
                            : 'border-line bg-white text-ink hover:border-brand/45 hover:bg-canvas/70'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                                selected ? 'bg-white/12 text-sky-300' : 'bg-subtle text-brand'
                              }`}
                            >
                              <RoleIcon className="h-3.5 w-3.5" />
                            </span>
                            <span className="truncate text-[13px] font-bold">{item.roleLabel}</span>
                            {roleScopeTab === 'all' && isCore && (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  selected ? 'bg-teal/25 text-teal-200' : 'bg-brand/10 text-brand'
                                }`}
                              >
                                核心
                              </span>
                            )}
                          </div>
                          {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-300" />}
                        </div>

                        <p
                          className={`mt-1.5 line-clamp-2 text-[11.5px] leading-snug ${
                            selected ? 'text-slate-300' : 'text-ink-secondary'
                          }`}
                        >
                          {getRoleSummaryForIdentity(item)}
                        </p>

                        {selected && defaultLandingMeta && (
                          <div className="mt-2 flex w-full items-center justify-between border-t border-white/10 pt-1.5 text-[10.5px] text-sky-200/90">
                            <span>登录后进入：{defaultLandingMeta.label}</span>
                            <span className="hidden text-slate-300/80 sm:inline">双击卡片可直达</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom mTLS Certificate Preview Card + Sticky Login CTA */}
          <div className="sticky bottom-0 z-20 -mx-5 mt-4 border-t border-line bg-white/95 px-5 pt-3.5 pb-2 backdrop-blur-md sm:static sm:mx-0 sm:border-t-0 sm:bg-transparent sm:px-0 sm:pt-3 sm:pb-0">
            {activeSelection && (
              <div className="mb-3 rounded-2xl border border-line/90 bg-canvas/75 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs">
                    <Fingerprint className="h-3.5 w-3.5 shrink-0 text-brand" />
                    <strong className="truncate font-bold text-navy-950">{activeSelection.roleLabel}</strong>
                    <span className="text-ink-muted">·</span>
                    <span className="mono text-[11px] text-ink-secondary">
                      证书指纹 {activeSelection.fingerprintPrefix}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                    <Lock className="h-2.5 w-2.5" />
                    服务端托管 · 零前端私钥
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="可访问工作台模块">
                  <span className="text-[11px] font-medium text-ink-secondary">可访问模块：</span>
                  {visibleModulePills.map(r => (
                    <span
                      key={r.href}
                      className="rounded-md border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-navy-900"
                    >
                      {r.label}
                    </span>
                  ))}
                  {extraModuleCount > 0 && (
                    <span
                      title={allowedRouteMetas.map(r => r.label).join('、')}
                      className="mono rounded-md border border-brand/20 bg-brand/[0.06] px-2 py-0.5 text-[11px] font-semibold text-brand"
                    >
                      +{extraModuleCount} 项
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={switching || loading || entering || !activeSelection}
              onClick={() => void loginWithIdentity(activeSelection)}
              className="group relative inline-flex w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-brand via-sky-500 to-teal px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {entering || switching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>正在进入工作台...</span>
                </>
              ) : (
                <>
                  <span>
                    {defaultLandingMeta
                      ? `登录并进入「${defaultLandingMeta.label}」`
                      : '登录进入工作台'}
                  </span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  <kbd className="mono ml-1 hidden rounded-md border border-white/25 bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/95 sm:inline-block">
                    Enter ↵
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
