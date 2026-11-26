'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Compass,
  Cpu,
  Eye,
  Factory,
  FileCheck2,
  History,
  Layers,
  Loader2,
  Lock,
  Microscope,
  QrCode,
  Recycle,
  Settings2,
  ShieldCheck,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { useToast } from '@/components/ToastProvider';
import {
  ALL_ROUTES,
  CORE_IDENTITY_NAMES,
  ORG_PROFILES,
  canAccessRoute,
  getDefaultRouteForActor,
  getRoleSummaryForIdentity,
  type RouteMeta,
} from '@/lib/permissions';
import type { OrganizationMSP, PublicIdentity } from '@/lib/types';

const LAST_LOGIN_KEY = 'tg_last_login_actor';

const NAV_SHORTCUTS: { label: string; msp: OrganizationMSP }[] = [
  { label: '数字身份', msp: 'CellOrgMSP' },
  { label: '谱系追溯', msp: 'PackOrgMSP' },
  { label: '质量检测', msp: 'LabOrgMSP' },
  { label: '联合审批', msp: 'PackOrgMSP' },
  { label: '退役回收', msp: 'RecycleOrgMSP' },
];

const ORG_TAB_NAMES: Record<OrganizationMSP, string> = {
  CellOrgMSP: '电芯制造',
  PackOrgMSP: 'PACK 装配',
  LabOrgMSP: '独立检测',
  RecycleOrgMSP: '退役回收',
};

const HERO_PILLARS = [
  {
    icon: QrCode,
    title: '24 位国标身份',
    desc: '三级资产编码与源头建档',
    accent: 'text-sky-400 bg-brand/15 border-sky-400/25',
  },
  {
    icon: ShieldCheck,
    title: '四方联盟背书',
    desc: '跨企流转与联合放行防篡改',
    accent: 'text-teal-300 bg-teal/15 border-teal-400/25',
  },
  {
    icon: Cpu,
    title: '双轨主动风控',
    desc: '离群筛查与加密质检门禁',
    accent: 'text-blue-300 bg-info/15 border-blue-400/25',
  },
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
    const exactDefault = coreMatches.find(id => getDefaultRouteForActor(id) === targetPath);
    return exactDefault ?? coreMatches[0];
  }
  return identities.find(id => canAccessRoute(id, targetPath)) ?? null;
}

export function LoginPortal() {
  const router = useRouter();
  const pathname = usePathname();
  const { identities, loading, switching, switchActor } = useIdentity();
  const { notify } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedMsp, setSelectedMsp] = useState<OrganizationMSP>('CellOrgMSP');
  const [roleScopeTab, setRoleScopeTab] = useState<'core' | 'all'>('core');
  const [hoveredRoleName, setHoveredRoleName] = useState<string | null>(null);
  const [enteringName, setEnteringName] = useState<string | null>(null);
  const [lastActorName, setLastActorName] = useState<string | null>(null);
  const [deepLinkPath, setDeepLinkPath] = useState<string | null>(null);
  const [chainBlockHeight, setChainBlockHeight] = useState<number | null>(null);
  const deepLinkHandledRef = useRef(false);

  useEffect(() => {
    let active = true;
    const saved = readLastLoginActor();
    const targetPath = resolveDeepLinkPath();
    queueMicrotask(() => {
      if (!active) return;
      if (saved) setLastActorName(saved);
      setDeepLinkPath(targetPath);
      if (!targetPath) {
        deepLinkHandledRef.current = false;
        setModalOpen(false);
      }
    });
    return () => {
      active = false;
    };
  }, [pathname]);

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
    if (deepLinkHandledRef.current || identities.length === 0) return;
    if (deepLinkPath && deepLinkMeta) {
      deepLinkHandledRef.current = true;
      const recommended = pickBestIdentityForPath(identities, deepLinkPath, lastIdentity);
      queueMicrotask(() => {
        if (recommended) {
          setSelectedMsp(recommended.mspId);
          if (!CORE_IDENTITY_NAMES.has(recommended.name)) {
            setRoleScopeTab('all');
          }
        }
        setModalOpen(true);
      });
    }
  }, [deepLinkMeta, deepLinkPath, identities, lastIdentity]);

  useEffect(() => {
    if (!modalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !enteringName) {
        setModalOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enteringName, modalOpen]);

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
    return { core, all: [...core, ...aux] };
  }, [identities, selectedMsp]);

  const visibleRoles = roleScopeTab === 'core' ? orgIdentities.core : orgIdentities.all;

  const selectedOrgProfile = useMemo(
    () => ORG_PROFILES.find(o => o.mspId === selectedMsp) ?? ORG_PROFILES[0],
    [selectedMsp],
  );

  const loginWithIdentity = useCallback(
    async (target: PublicIdentity | null) => {
      if (!target || switching || loading || enteringName) return;
      setEnteringName(target.name);
      saveLastLoginActor(target.name);

      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/login';
      const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
      const params = new URLSearchParams(currentSearch);
      const redirectParam = params.get('redirect') ?? '';

      try {
        await switchActor(target.name, { enableRoleScope: true });
        notify({
          tone: 'success',
          title: `欢迎回来，${target.roleLabel}`,
          description: `${target.orgLabel.split(' ')[0]} · 已进入专属工作台`,
        });
        window.setTimeout(() => {
          if (currentPath !== '/login' && canAccessRoute(target, currentPath)) {
            setEnteringName(null);
            setModalOpen(false);
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
      } catch {
        setEnteringName(null);
      }
    },
    [enteringName, loading, notify, router, switchActor, switching],
  );

  function openPicker(msp?: OrganizationMSP) {
    if (msp) setSelectedMsp(msp);
    setModalOpen(true);
  }

  return (
    <div className="login-workspace-canvas relative flex min-h-screen w-full flex-col justify-between overflow-x-hidden text-white selection:bg-brand/35">
      {/* =================================================================== */}
      {/* 1. TOP BAR: Workspace-Aligned Deep Navy Glass Header                */}
      {/* =================================================================== */}
      <header className="w-full border-b border-sky-400/12 bg-[#071324]/65 backdrop-blur-md">
        <div className="mx-auto flex h-[74px] w-full max-w-[1600px] items-center justify-between px-6 sm:px-10 lg:px-14">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-mark.png"
              alt="智权链·锂安溯"
              width={38}
              height={38}
              className="h-9 w-9 object-contain drop-shadow-[0_4px_14px_rgba(37,99,235,0.38)] select-none"
            />
            <div>
              <div className="text-[16px] font-bold tracking-wide text-white sm:text-[17px]">
                智权链 · 锂安溯
              </div>
              <div className="hidden text-[10.5px] font-medium text-teal-300/90 sm:block">
                动力电池溯源与主动安全工作台
              </div>
            </div>
          </div>

          <nav aria-label="平台核心能力" className="hidden items-center gap-8 md:flex lg:gap-10">
            {NAV_SHORTCUTS.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => openPicker(item.msp)}
                className="cursor-pointer text-[13.5px] font-medium text-slate-300/85 transition hover:text-sky-300"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-sky-400/20 bg-[#0c1f36]/80 px-3 py-1.5 text-xs font-medium text-slate-300 xl:inline-flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              {chainBlockHeight ? `联盟链在线 · #${chainBlockHeight}` : '四组织联盟在线'}
            </span>
            <button
              type="button"
              onClick={() => openPicker()}
              className="brand-cta-sm cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold tracking-wide text-white active:scale-[0.98] sm:px-5 sm:py-2.5 sm:text-[13.5px]"
            >
              选择身份
            </button>
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* 2. CENTER HERO: Balanced 54:46 Golden Proportion & Rich Subcards    */}
      {/* =================================================================== */}
      <main className="mx-auto flex w-full max-w-[1520px] flex-1 items-center px-6 py-8 sm:px-10 lg:px-14 lg:py-6">
        <div className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-[54%_46%] lg:gap-10">
          {/* Left Column: Eyebrow + Crisp Title + 3 Workspace Navy Subcards + CTA */}
          <div className="order-2 flex flex-col items-start lg:order-1">
            {/* Eyebrow Status Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-500/10 px-3.5 py-1.5 text-xs font-semibold text-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
              <span>GB/T 34014 国家标准编码体系 · 联盟链多方共治</span>
            </div>

            <h1
              style={{ fontSize: 'clamp(2.35rem, 4.1vw, 3.85rem)' }}
              className="mt-5 leading-[1.12] font-extrabold tracking-tight text-white"
            >
              智权链 · 锂安溯
            </h1>

            <p
              style={{ fontSize: 'clamp(1.25rem, 2.05vw, 1.85rem)' }}
              className="mt-2.5 font-bold tracking-tight text-sky-200/95"
            >
              动力电池全生命周期可信溯源与主动安全平台
            </p>

            <p className="mt-4 max-w-[590px] text-sm leading-relaxed text-slate-300/85 sm:text-[15px]">
              串联电芯制造、成组装配、独立检测与退役回收四家联盟机构，让每一颗电芯的质量报告、流转交接与放行审批都在链上留痕、实时受控。
            </p>

            {/* 3 Workspace-Matched Navy Subcards (.navy-subcard material) */}
            <div className="mt-6 grid w-full max-w-[620px] grid-cols-1 gap-2.5 sm:grid-cols-3">
              {HERO_PILLARS.map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="navy-subcard flex items-start gap-2.5 p-3.5">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${item.accent}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-slate-100">{item.title}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{item.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Primary & Secondary Action Row */}
            <div className="mt-7 flex flex-wrap items-center gap-3.5 sm:mt-8">
              <button
                type="button"
                onClick={() => openPicker()}
                className="brand-cta-lg group inline-flex cursor-pointer items-center gap-2.5 rounded-[14px] px-7 py-3.5 text-[15px] font-bold tracking-wide text-white active:scale-[0.98] sm:px-8 sm:py-4 sm:text-base"
              >
                <span>选择身份进入工作台</span>
                <ArrowRight className="h-[18px] w-[18px] transition-transform duration-150 group-hover:translate-x-0.5" />
              </button>

              {lastIdentity && (
                <button
                  type="button"
                  disabled={Boolean(enteringName) || switching || loading}
                  onClick={() => void loginWithIdentity(lastIdentity)}
                  className="glass-ghost-btn inline-flex cursor-pointer items-center gap-2 rounded-[14px] px-5 py-3.5 text-sm font-semibold text-slate-200 active:scale-[0.98] disabled:opacity-50 sm:py-4"
                >
                  {enteringName === lastIdentity.name ? (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                  ) : (
                    <History className="h-4 w-4 text-sky-300" />
                  )}
                  <span className="whitespace-nowrap">继续上次：{lastIdentity.roleLabel}</span>
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Centered Sculpture Stage + Subtle Orbital Rings & Floating Micro-Badges */}
          <div className="order-1 flex items-center justify-center lg:order-2">
            <div className="login-sculpture-stage">
              {/* Subtle Precision Orbital Rings Behind Sculpture */}
              <svg
                viewBox="0 0 560 560"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 m-auto h-[104%] w-[104%] opacity-75"
              >
                <circle
                  cx="280"
                  cy="265"
                  r="225"
                  fill="none"
                  stroke="rgba(56, 189, 248, 0.14)"
                  strokeWidth="1"
                  strokeDasharray="4 7"
                />
                <circle
                  cx="280"
                  cy="265"
                  r="178"
                  fill="none"
                  stroke="rgba(37, 99, 235, 0.18)"
                  strokeWidth="1"
                />
                <circle cx="92" cy="142" r="3.5" fill="#38bdf8" opacity="0.7" />
                <circle cx="472" cy="150" r="3.5" fill="#2dd4bf" opacity="0.7" />
                <circle cx="76" cy="360" r="3" fill="#60a5fa" opacity="0.55" />
                <circle cx="484" cy="362" r="3" fill="#34d399" opacity="0.55" />
              </svg>

              <div aria-hidden="true" className="login-sculpture-aura" />
              <div aria-hidden="true" className="login-sculpture-floor" />

              {/* Floating Glass Micro-Badge (Top-Left) */}
              <div className="navy-subcard pointer-events-none absolute top-4 left-0 z-10 hidden items-center gap-2 px-3 py-2 text-xs shadow-lg sm:flex lg:-left-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/25 text-sky-300">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-[11.5px] font-bold text-white">服务端托管证书</div>
                  <div className="text-[10px] text-slate-400">前端零私钥留存</div>
                </div>
              </div>

              {/* Floating Glass Micro-Badge (Bottom-Right, Clickable) */}
              <button
                type="button"
                onClick={() => openPicker()}
                className="navy-subcard absolute right-0 bottom-6 z-10 hidden cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs shadow-lg sm:flex lg:-right-2"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal/25 text-teal-300">
                  <Building2 className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-[11.5px] font-bold text-white">4 联盟机构 · 28 身份</div>
                  <div className="text-[10px] text-sky-300">点击快速切换岗位 →</div>
                </div>
              </button>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/visuals/login-logo-3d.webp"
                alt="智权链·锂安溯 立体磨砂玻璃徽标雕塑"
                width={792}
                height={817}
                className="login-sculpture-img h-[250px] w-auto object-contain select-none sm:h-[340px] lg:h-[min(39vw,535px)]"
              />
            </div>
          </div>
        </div>
      </main>

      {/* =================================================================== */}
      {/* 3. BOTTOM CONSORTIUM BAR: Anchors Vertical Balance & Direct Access  */}
      {/* =================================================================== */}
      <footer className="w-full border-t border-sky-400/12 bg-[#071324]/70 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-3.5 text-xs text-slate-400 sm:px-10 lg:px-14">
          <div className="flex flex-wrap items-center gap-2 sm:gap-5">
            <span className="font-semibold text-slate-300">联盟共识节点：</span>
            {ORG_PROFILES.map(org => (
              <button
                key={org.mspId}
                type="button"
                onClick={() => openPicker(org.mspId)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-300/90 transition hover:bg-white/[0.06] hover:text-sky-300"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{org.shortName}</span>
                <span className="mono text-[11px] text-slate-500">{org.peerPort.replace('Peer ', '')}</span>
              </button>
            ))}
          </div>

          <div className="mono hidden text-[11px] text-slate-500 lg:block">
            GB/T 34014—2017 · Hyperledger Fabric 2.5
          </div>
        </div>
      </footer>

      {/* =================================================================== */}
      {/* 4. IDENTITY MODAL: Workspace-Aligned Deep Navy + Royal Tech Blue    */}
      {/* =================================================================== */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="identity-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#040a14]/75 px-4 py-5 backdrop-blur-lg"
          onClick={e => {
            if (e.target === e.currentTarget && !enteringName) setModalOpen(false);
          }}
        >
          <div className="identity-modal-shell animate-modal-in flex max-h-[90vh] w-full max-w-[740px] flex-col overflow-hidden rounded-[24px]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-sky-400/12 px-6 pt-6 pb-5 sm:px-7">
              <div>
                <h2 id="identity-modal-title" className="text-[18px] font-bold tracking-wide text-white sm:text-[19px]">
                  选择联盟身份
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  点选所属机构与业务岗位，一步进入对应工作台
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭窗口"
                disabled={Boolean(enteringName)}
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] border border-sky-400/15 bg-white/[0.05] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 sm:px-7">
              {/* Deep-Link Guide Banner */}
              {deepLinkMeta && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-sky-400/30 bg-brand/15 px-4 py-3 text-xs text-sky-200">
                  <Compass className="h-4 w-4 shrink-0 text-sky-400" />
                  <span>
                    正在前往 <strong className="text-white">「{deepLinkMeta.label}」</strong>，点选下方具备查看权限的岗位即可自动直达。
                  </span>
                </div>
              )}

              {/* Passcard-Style Last Login Quick Resume */}
              {lastIdentity && (
                <button
                  type="button"
                  disabled={Boolean(enteringName) || switching || loading}
                  onClick={() => void loginWithIdentity(lastIdentity)}
                  className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-[15px] border border-sky-400/30 bg-gradient-to-r from-brand/[0.18] to-teal/[0.1] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-sky-300/55 hover:from-brand/[0.26] disabled:opacity-50"
                >
                  <div className="flex min-w-0 items-center gap-2.5 text-[13px] text-slate-300">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
                    <span className="truncate">
                      上次登录：<strong className="font-bold text-white">{lastIdentity.roleLabel}</strong> ·{' '}
                      {lastIdentity.orgLabel.split(' ')[0]}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-[9px] border border-sky-300/35 bg-brand/30 px-3 py-1 text-xs font-semibold text-sky-200 transition group-hover:bg-brand/45 group-hover:text-white">
                    {enteringName === lastIdentity.name ? '正在进入…' : '一键恢复会话 →'}
                  </span>
                </button>
              )}

              {/* Recessed Dark Crystal Segmented Org Track */}
              <div className="identity-org-track grid grid-cols-2 gap-1.5 rounded-2xl p-1.5 sm:grid-cols-4">
                {ORG_PROFILES.map(org => {
                  const active = selectedMsp === org.mspId;
                  const totalCount = roleCountsByMsp[org.mspId] ?? 0;
                  return (
                    <button
                      key={org.mspId}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedMsp(org.mspId)}
                      className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition ${
                        active
                          ? 'identity-org-pill-active text-white'
                          : 'border border-transparent text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                      }`}
                    >
                      <span className="whitespace-nowrap">{ORG_TAB_NAMES[org.mspId]}</span>
                      {totalCount > 0 && (
                        <span
                          className={`mono rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                            active ? 'bg-white/20 text-white' : 'bg-white/[0.07] text-slate-400'
                          }`}
                        >
                          {totalCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Scope Tagline + Core/All Switch */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <p className="text-xs text-slate-400">{selectedOrgProfile.tagline}</p>

                <div className="inline-flex rounded-[10px] border border-sky-400/12 bg-[#06101e] p-[3px] text-[11.5px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setRoleScopeTab('core')}
                    className={`cursor-pointer rounded-[7px] px-2.5 py-1 transition ${
                      roleScopeTab === 'core' ? 'bg-brand text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    核心岗 ({orgIdentities.core.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoleScopeTab('all')}
                    className={`cursor-pointer rounded-[7px] px-2.5 py-1 transition ${
                      roleScopeTab === 'all' ? 'bg-brand text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    全部 ({orgIdentities.all.length})
                  </button>
                </div>
              </div>

              {/* 2-Column Layered Glass Role Cards */}
              {loading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton-block-dark h-[74px] rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {visibleRoles.map(item => {
                    const RoleIcon = ROLE_ICONS[item.role] ?? UserCheck;
                    const isEntering = enteringName === item.name;
                    const isHovered = hoveredRoleName === item.name;
                    const destHref =
                      deepLinkPath && canAccessRoute(item, deepLinkPath)
                        ? deepLinkPath
                        : getDefaultRouteForActor(item);
                    const destLabel = findRouteMeta(destHref)?.label ?? '工作台';
                    const summary = getRoleSummaryForIdentity(item);

                    return (
                      <button
                        key={item.name}
                        type="button"
                        disabled={Boolean(enteringName) || switching}
                        onMouseEnter={() => setHoveredRoleName(item.name)}
                        onMouseLeave={() => setHoveredRoleName(prev => (prev === item.name ? null : prev))}
                        onFocus={() => setHoveredRoleName(item.name)}
                        onBlur={() => setHoveredRoleName(prev => (prev === item.name ? null : prev))}
                        onClick={() => void loginWithIdentity(item)}
                        className="identity-role-card flex w-full cursor-pointer items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <div className="identity-role-icon flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-sky-300">
                          {isEntering ? (
                            <Loader2 className="h-[18px] w-[18px] animate-spin text-white" />
                          ) : (
                            <RoleIcon className="h-[18px] w-[18px]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14.5px] font-bold text-slate-50">
                            {item.roleLabel}
                          </div>
                          <p
                            className={`mt-0.5 truncate text-xs transition-colors duration-150 ${
                              isHovered || isEntering ? 'text-sky-200' : 'text-slate-400'
                            }`}
                          >
                            {isEntering
                              ? `正在进入${destLabel}…`
                              : isHovered
                                ? `进入${destLabel} · ${summary}`
                                : summary}
                          </p>
                        </div>

                        <div className="identity-role-arrow flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-slate-400">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Minimal Security Footer */}
            <div className="flex items-center justify-between border-t border-sky-400/12 bg-[#06101e]/85 px-6 py-3.5 text-[11.5px] text-slate-500 sm:px-7">
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <Lock className="h-3.5 w-3.5 text-sky-400" />
                服务端安全托管身份 · 零前端私钥留存
              </span>
              <span className="mono">GB/T 34014—2017</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return <LoginPortal />;
}
