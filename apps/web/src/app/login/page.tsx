'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileSearch,
  FlaskConical,
  GitBranch,
  History,
  LayoutDashboard,
  Loader2,
  QrCode,
  Shield,
  UserCheck,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { useToast } from '@/components/ToastProvider';
import {
  ALL_ROUTES,
  CORE_IDENTITY_NAMES,
  ORG_PROFILES,
  getAllowedRoutes,
  getDefaultRouteForActor,
  getRoleSummaryForIdentity,
  type RoutePath,
} from '@/lib/permissions';
import type { OrganizationMSP, PublicIdentity } from '@/lib/types';

const LAST_LOGIN_KEY = 'tg_last_login_actor';

const ORG_VISUALS: Record<
  OrganizationMSP,
  {
    image: string;
    activeRing: string;
    indicatorColor: string;
    badgeTone: string;
  }
> = {
  CellOrgMSP: {
    image: '/visuals/org-cell.jpg',
    activeRing: 'border-brand ring-2 ring-brand/25 shadow-md shadow-brand/10',
    indicatorColor: 'bg-brand',
    badgeTone: 'text-brand',
  },
  PackOrgMSP: {
    image: '/visuals/org-pack.jpg',
    activeRing: 'border-teal ring-2 ring-teal/25 shadow-md shadow-teal/10',
    indicatorColor: 'bg-teal',
    badgeTone: 'text-teal',
  },
  LabOrgMSP: {
    image: '/visuals/org-lab.jpg',
    activeRing: 'border-info ring-2 ring-info/25 shadow-md shadow-info/10',
    indicatorColor: 'bg-info',
    badgeTone: 'text-[#1d5fa3]',
  },
  RecycleOrgMSP: {
    image: '/visuals/org-recycle.jpg',
    activeRing: 'border-success ring-2 ring-success/25 shadow-md shadow-success/10',
    indicatorColor: 'bg-success',
    badgeTone: 'text-success',
  },
};

const ROUTE_ICONS: Record<RoutePath, React.ComponentType<{ className?: string }>> = {
  '/': LayoutDashboard,
  '/identity': QrCode,
  '/inspections': Activity,
  '/trace': GitBranch,
  '/approvals': ClipboardCheck,
  '/transfers': ArrowLeftRight,
  '/risk': Cpu,
  '/policies': Shield,
  '/lab': FlaskConical,
  '/audit': FileSearch,
  '/organizations': Building2,
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

export function LoginPortal() {
  const router = useRouter();
  const { identities, loading, switching, switchActor } = useIdentity();
  const { notify } = useToast();

  const [selectedMsp, setSelectedMsp] = useState<OrganizationMSP>('CellOrgMSP');
  const [selectedName, setSelectedName] = useState<string>('');
  const [entering, setEntering] = useState(false);
  const [lastActorName, setLastActorName] = useState<string | null>(null);
  const roleBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let active = true;
    const saved = readLastLoginActor();
    if (saved) {
      queueMicrotask(() => {
        if (active) setLastActorName(saved);
      });
    }
    return () => {
      active = false;
    };
  }, []);

  const lastIdentity = useMemo(
    () => (lastActorName ? identities.find(i => i.name === lastActorName) ?? null : null),
    [identities, lastActorName],
  );

  const roleCountsByMsp = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of identities) {
      counts[id.mspId] = (counts[id.mspId] ?? 0) + 1;
    }
    return counts;
  }, [identities]);

  const orgIdentities = useMemo(() => {
    const filtered = identities.filter(id => id.mspId === selectedMsp);
    const core = filtered.filter(id => CORE_IDENTITY_NAMES.has(id.name));
    const aux = filtered.filter(id => !CORE_IDENTITY_NAMES.has(id.name));
    return [...core, ...aux];
  }, [identities, selectedMsp]);

  const activeSelection = useMemo(() => {
    const matched = orgIdentities.find(id => id.name === selectedName);
    if (matched) return matched;
    return orgIdentities[0] ?? null;
  }, [orgIdentities, selectedName]);

  const allowedRoutes = useMemo(() => getAllowedRoutes(activeSelection), [activeSelection]);
  const allowedRouteMetas = useMemo(
    () => ALL_ROUTES.filter(r => allowedRoutes.includes(r.href)),
    [allowedRoutes],
  );

  const selectedOrgProfile = useMemo(
    () => ORG_PROFILES.find(o => o.mspId === selectedMsp) ?? ORG_PROFILES[0],
    [selectedMsp],
  );

  const loginWithIdentity = useCallback(
    async (target: PublicIdentity | null) => {
      if (!target || switching || loading || entering) return;
      setEntering(true);
      saveLastLoginActor(target.name);
      await switchActor(target.name, { enableRoleScope: true });
      notify({
        tone: 'success',
        title: `欢迎回来，${target.roleLabel}`,
        description: `${target.orgLabel.split(' ')[0]} · 已进入专属工作台`,
      });
      window.setTimeout(() => {
        router.push(getDefaultRouteForActor(target));
      }, 180);
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
    const len = orgIdentities.length;
    if (len === 0) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % len;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + len) % len;
    else if (e.key === 'ArrowDown') nextIdx = (idx + 2) % len;
    else if (e.key === 'ArrowUp') nextIdx = (idx - 2 + len) % len;
    if (nextIdx >= 0) {
      e.preventDefault();
      setSelectedName(orgIdentities[nextIdx].name);
      roleBtnRefs.current[nextIdx]?.focus();
    }
  }

  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-white lg:grid-cols-[54%_46%]">
      {/* LEFT (54% Desktop / Compact Header Mobile): Pure Ultra-Clean Enlarged Brand Showcase */}
      <section className="login-brand-canvas relative flex flex-col justify-between overflow-hidden px-5 py-6 lg:border-r lg:border-[#d4e6f9] lg:px-12 lg:py-9">
        {/* Flowing Blue-Green Wave Ribbon at Bottom (Desktop) */}
        <svg
          viewBox="0 0 1200 260"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 left-0 hidden h-60 w-full lg:block"
        >
          <defs>
            <linearGradient id="tgWaveA" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
              <stop offset="52%" stopColor="#0ea5e9" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.26" />
            </linearGradient>
            <linearGradient id="tgWaveB" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.24" />
            </linearGradient>
          </defs>
          <path
            d="M0,150 C260,65 520,235 820,125 C980,68 1110,115 1200,90 L1200,260 L0,260 Z"
            fill="url(#tgWaveA)"
          />
          <path
            d="M0,195 C300,125 600,245 920,155 C1060,118 1145,148 1200,138 L1200,260 L0,260 Z"
            fill="url(#tgWaveB)"
          />
        </svg>

        <div className="hidden lg:block" />

        {/* Centerpiece: Giant Seamless Official Brand Logo (440px–480px on Desktop) */}
        <div
          className={`relative z-10 flex flex-col items-center text-center transition-all duration-300 ${
            entering ? 'scale-105 opacity-0' : 'scale-100 opacity-100'
          }`}
        >
          <h1 className="sr-only">智权链 · 锂安溯</h1>

          <div className="animate-logo-float relative flex items-center justify-center">
            <div
              className="pointer-events-none absolute -inset-10 hidden rounded-full opacity-80 blur-3xl lg:block"
              style={{
                background:
                  'radial-gradient(circle, rgba(56,189,248,0.24) 0%, rgba(20,184,166,0.16) 52%, transparent 74%)',
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-full.jpg"
              alt="智权链·锂安溯 TrustGuard Battery 官方标识"
              width={480}
              height={480}
              className="login-logo-seamless relative h-28 w-28 object-contain select-none sm:h-32 sm:w-32 lg:h-[430px] lg:w-[430px] xl:h-[470px] xl:w-[470px]"
            />
          </div>

          <p className="mt-2 max-w-md text-xs font-semibold tracking-wider text-[#173657] sm:text-sm lg:mt-4 lg:text-base">
            动力电池全生命周期可信溯源与主动安全管理平台
          </p>
        </div>

        {/* Bottom-left subtle copyright */}
        <div className="relative z-10 hidden items-center justify-between text-[11px] font-medium text-[#52708f] lg:flex">
          <span>© 2026 智权链·锂安溯 · TrustGuard Battery</span>
          <span className="mono">GB/T 34014 · v2.1</span>
        </div>
      </section>

      {/* RIGHT (46% Desktop): Clean Top-to-Bottom Login Workspace */}
      <section className="flex flex-col justify-between bg-white px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
          {/* Header + Remember Last Login Quick Entry */}
          <div className="flex flex-wrap items-end justify-between gap-2 pb-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-navy-950 sm:text-2xl">欢迎登录</h2>
              <p className="mt-1 text-xs text-ink-secondary">请先选定企业与工作岗位，进入专属工作台</p>
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
            <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-navy-900">
              <span className="mono flex h-5 w-5 items-center justify-center rounded-md bg-brand text-[11px] text-white">
                1
              </span>
              <Building2 className="h-3.5 w-3.5 text-brand" />
              <span>选择所属企业</span>
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
                    onClick={() => {
                      setSelectedMsp(org.mspId);
                      setSelectedName('');
                    }}
                    className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-left transition duration-150 ${
                      active
                        ? visual.activeRing
                        : 'border-line hover:border-brand/40 hover:shadow-sm'
                    }`}
                  >
                    {/* Generated 3D Industrial Scene Visual */}
                    <div className="relative h-16 w-full overflow-hidden bg-[#060f1d] sm:h-[70px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={visual.image}
                        alt={org.shortName}
                        className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-105 select-none"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060f1d]/75 via-transparent to-transparent" />
                      {count > 0 && (
                        <span className="mono absolute top-1.5 right-1.5 rounded-full border border-white/25 bg-[#061224]/92 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs backdrop-blur-xs">
                          {count} 岗
                        </span>
                      )}
                      {active && (
                        <CheckCircle2 className="absolute top-1.5 left-1.5 h-4 w-4 rounded-full bg-white text-brand shadow-xs" />
                      )}
                    </div>

                    {/* Clean Enterprise Label */}
                    <div className="relative px-2 py-2 text-center">
                      <div
                        className={`truncate text-xs font-bold ${
                          active ? visual.badgeTone : 'text-ink'
                        }`}
                      >
                        {org.shortName}
                      </div>
                      <span
                        className={`absolute right-3 bottom-0 left-3 h-[3px] rounded-t-full transition-all duration-200 ${
                          active ? `${visual.indicatorColor} opacity-100` : 'opacity-0'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Clean complete enterprise scope line */}
            <div className="mt-2.5 rounded-xl bg-canvas/85 px-3.5 py-2 text-xs leading-relaxed text-ink-secondary">
              <strong className="font-semibold text-ink">{selectedOrgProfile.shortName}：</strong>
              <span>{selectedOrgProfile.tagline}</span>
            </div>
          </div>

          {/* Step 2: Select Role / Position — Fixed-Height Zone, All Roles Flat in 2 Columns */}
          <div className="mt-5">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-navy-900">
                <span className="mono flex h-5 w-5 items-center justify-center rounded-md bg-teal text-[11px] text-white">
                  2
                </span>
                <UserCheck className="h-3.5 w-3.5 text-teal" />
                <span>选择登录岗位</span>
              </div>
              <span className="mono text-[11px] font-medium text-ink-secondary">
                共 {orgIdentities.length} 个岗位
              </span>
            </div>

            <div className="flex flex-col justify-center lg:min-h-[276px]">
              {loading ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton-block h-[80px]" />
                  ))}
                </div>
              ) : (
                <div aria-label="岗位列表" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {orgIdentities.map((item, idx) => {
                    const selected = activeSelection?.name === item.name;
                    const isCore = CORE_IDENTITY_NAMES.has(item.name);
                    const spanFull = orgIdentities.length % 2 === 1 && idx === orgIdentities.length - 1;
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
                        className={`flex min-h-[80px] cursor-pointer flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition duration-150 ${
                          spanFull ? 'sm:col-span-2' : ''
                        } ${
                          selected
                            ? 'border-navy-900 bg-gradient-to-br from-[#0e223a] to-[#173558] text-white shadow-md shadow-navy-950/20'
                            : 'border-line bg-white text-ink hover:border-brand/45 hover:bg-canvas/70'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[13px] font-bold">{item.roleLabel}</span>
                            {isCore && (
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
                          className={`mt-1 line-clamp-2 text-[11.5px] leading-relaxed ${
                            selected ? 'text-slate-300' : 'text-ink-secondary'
                          }`}
                        >
                          {getRoleSummaryForIdentity(item)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="sticky bottom-0 z-20 -mx-5 mt-5 border-t border-line bg-white/95 px-5 pt-4 pb-2 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:pb-0">
            {activeSelection && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <span className="text-ink-secondary">当前身份：</span>
                  <strong className="font-bold text-navy-950">{activeSelection.roleLabel}</strong>
                  <span className="mx-1 text-ink-muted">·</span>
                  <span className="text-ink-secondary">{selectedOrgProfile.shortName}</span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5" aria-label="可用工作台模块">
                  <span className="text-[11px] font-medium text-ink-secondary">可访问 {allowedRouteMetas.length} 项：</span>
                  {allowedRouteMetas.map(r => {
                    const Icon = ROUTE_ICONS[r.href];
                    return (
                      <span
                        key={r.href}
                        title={r.label}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line/90 bg-subtle/85 text-navy-800 transition hover:border-brand/50 hover:bg-brand/10 hover:text-brand"
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    );
                  })}
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
                  <span>登录进入工作台</span>
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
