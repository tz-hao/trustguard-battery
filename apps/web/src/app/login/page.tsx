'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Compass,
  Eye,
  Factory,
  FileCheck2,
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

const ORG_MODAL_TONES: Record<OrganizationMSP, React.CSSProperties> = {
  CellOrgMSP: {
    ['--org-accent-a' as string]: 'rgba(37, 99, 235, 0.38)',
    ['--org-accent-b' as string]: 'rgba(14, 165, 233, 0.28)',
    ['--org-hover-a' as string]: 'rgba(37, 99, 235, 0.26)',
    ['--org-hover-b' as string]: 'rgba(14, 165, 233, 0.18)',
    ['--org-border' as string]: 'rgba(125, 211, 252, 0.56)',
    ['--org-shadow' as string]: 'rgba(37, 99, 235, 0.34)',
    ['--org-icon-a' as string]: '#2563eb',
    ['--org-icon-b' as string]: '#0284c7',
    ['--org-arrow-bg' as string]: 'rgba(56, 189, 248, 0.24)',
    ['--org-arrow-fg' as string]: '#7dd3fc',
  },
  PackOrgMSP: {
    ['--org-accent-a' as string]: 'rgba(29, 111, 242, 0.32)',
    ['--org-accent-b' as string]: 'rgba(13, 148, 136, 0.34)',
    ['--org-hover-a' as string]: 'rgba(29, 111, 242, 0.24)',
    ['--org-hover-b' as string]: 'rgba(20, 184, 166, 0.2)',
    ['--org-border' as string]: 'rgba(94, 234, 212, 0.54)',
    ['--org-shadow' as string]: 'rgba(14, 165, 233, 0.34)',
    ['--org-icon-a' as string]: '#1d6ff2',
    ['--org-icon-b' as string]: '#0d9488',
    ['--org-arrow-bg' as string]: 'rgba(20, 184, 166, 0.26)',
    ['--org-arrow-fg' as string]: '#5eead4',
  },
  LabOrgMSP: {
    ['--org-accent-a' as string]: 'rgba(2, 132, 199, 0.36)',
    ['--org-accent-b' as string]: 'rgba(56, 189, 248, 0.26)',
    ['--org-hover-a' as string]: 'rgba(2, 132, 199, 0.24)',
    ['--org-hover-b' as string]: 'rgba(56, 189, 248, 0.18)',
    ['--org-border' as string]: 'rgba(125, 211, 252, 0.58)',
    ['--org-shadow' as string]: 'rgba(14, 165, 233, 0.34)',
    ['--org-icon-a' as string]: '#0284c7',
    ['--org-icon-b' as string]: '#0ea5e9',
    ['--org-arrow-bg' as string]: 'rgba(56, 189, 248, 0.24)',
    ['--org-arrow-fg' as string]: '#bae6fd',
  },
  RecycleOrgMSP: {
    ['--org-accent-a' as string]: 'rgba(13, 148, 136, 0.34)',
    ['--org-accent-b' as string]: 'rgba(16, 185, 129, 0.32)',
    ['--org-hover-a' as string]: 'rgba(13, 148, 136, 0.24)',
    ['--org-hover-b' as string]: 'rgba(16, 185, 129, 0.2)',
    ['--org-border' as string]: 'rgba(110, 231, 183, 0.54)',
    ['--org-shadow' as string]: 'rgba(16, 185, 129, 0.32)',
    ['--org-icon-a' as string]: '#0d9488',
    ['--org-icon-b' as string]: '#10b981',
    ['--org-arrow-bg' as string]: 'rgba(16, 185, 129, 0.24)',
    ['--org-arrow-fg' as string]: '#6ee7b7',
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

  const lastIdentity = useMemo(
    () => (lastActorName ? identities.find(i => i.name === lastActorName) ?? null : null),
    [identities, lastActorName],
  );

  const deepLinkMeta = useMemo(() => findRouteMeta(deepLinkPath), [deepLinkPath]);

  // Automatically open identity modal & pre-select authorized org when arriving via deep link
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
    <div className="login-minimal-canvas relative flex min-h-screen w-full flex-col overflow-x-hidden text-white selection:bg-teal-400/25">
      {/* Aligned Top Bar (Proportionally scaled up ~20% to match monumental hero) */}
      <header className="mx-auto flex h-20 w-full max-w-[1520px] shrink-0 items-center justify-between px-6 sm:h-[94px] sm:px-10 lg:px-14">
        <div className="flex items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-mark.png"
            alt="智权链·锂安溯"
            width={48}
            height={48}
            className="h-10 w-10 object-contain drop-shadow-[0_4px_16px_rgba(14,165,233,0.36)] select-none sm:h-12 sm:w-12"
          />
          <span className="bg-gradient-to-b from-white to-[#dbeafe] bg-clip-text text-lg font-bold tracking-wide text-transparent sm:text-[22px]">
            智权链·锂安溯
          </span>
        </div>

        <nav aria-label="平台核心能力" className="hidden items-center gap-9 md:flex lg:gap-12">
          {NAV_SHORTCUTS.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => openPicker(item.msp)}
              className="cursor-pointer text-[15.5px] font-medium text-[#93adc8] transition hover:text-[#a5f3fc] lg:text-[16.5px]"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => openPicker()}
          className="crystal-cta-sm cursor-pointer rounded-xl px-4 py-2 text-[13.5px] font-semibold tracking-wide text-white active:scale-[0.98] sm:px-6 sm:py-2.5 sm:text-[15.5px]"
        >
          选择身份
        </button>
      </header>

      {/* Balanced 2-Column Hero Stage (Uniformly scaled up ~20% with tight golden ratio) */}
      <main className="mx-auto grid w-full max-w-[1460px] flex-1 grid-cols-1 items-center gap-8 px-6 pt-2 pb-10 sm:px-10 lg:-mt-4 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12 lg:px-14 lg:py-0">
        {/* Left: Proportionally Enlarged Display Typography + Crystal Buttons */}
        <div className="order-2 flex flex-col items-start lg:order-1">
          <h1
            style={{ fontSize: 'clamp(2.65rem, 5.2vw, 5.25rem)' }}
            className="bg-gradient-to-b from-white via-white to-[#dbeafe] bg-clip-text leading-[1.08] font-extrabold tracking-tight text-transparent"
          >
            智权链 · 锂安溯
          </h1>
          <p
            style={{ fontSize: 'clamp(1.55rem, 3vw, 2.9rem)' }}
            className="mt-4 bg-gradient-to-r from-[#dbeafe] via-[#93c5fd] to-[#99f6e4] bg-clip-text font-bold tracking-tight text-transparent sm:mt-5"
          >
            - TrustGuard Battery -
          </p>

          <div className="mt-8 space-y-2.5 sm:mt-11 sm:space-y-3">
            <p
              style={{ fontSize: 'clamp(1.2rem, 1.9vw, 1.8rem)' }}
              className="bg-gradient-to-r from-[#38bdf8] via-[#2dd4bf] to-[#34d399] bg-clip-text font-bold tracking-wide text-transparent"
            >
              每一颗电芯，全周期可信。
            </p>
            <p
              style={{ fontSize: 'clamp(1.05rem, 1.58vw, 1.5rem)' }}
              className="leading-relaxed font-medium text-[#8ea6c2]"
            >
              四方联盟多点背书。
            </p>
            <p
              style={{ fontSize: 'clamp(1.05rem, 1.58vw, 1.5rem)' }}
              className="leading-relaxed font-medium text-[#8ea6c2]"
            >
              主动风控实时把关。
            </p>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-4 sm:mt-12 sm:gap-5">
            <button
              type="button"
              onClick={() => openPicker()}
              className="crystal-cta-lg group inline-flex cursor-pointer items-center gap-3 rounded-2xl px-7 py-3.5 text-base font-bold tracking-wide text-white active:scale-[0.98] sm:px-9 sm:py-[18px] sm:text-[18px]"
            >
              <span>选择身份登录</span>
              <ArrowRight className="h-5 w-5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </button>

            {lastIdentity && (
              <button
                type="button"
                disabled={Boolean(enteringName) || switching || loading}
                onClick={() => void loginWithIdentity(lastIdentity)}
                className="glass-ghost-btn inline-flex cursor-pointer items-center gap-2.5 rounded-2xl px-5 py-3.5 text-sm font-semibold text-[#d6e6f7] active:scale-[0.98] disabled:opacity-50 sm:px-6 sm:py-[18px] sm:text-[16.5px]"
              >
                {enteringName === lastIdentity.name ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin text-[#38bdf8]" />
                ) : (
                  <History className="h-[18px] w-[18px] text-[#7dd3fc]" />
                )}
                <span className="whitespace-nowrap">继续上次：{lastIdentity.roleLabel}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Proportionally Enlarged Grounded 3D Sculpture */}
        <div className="order-1 flex items-center justify-center lg:order-2">
          <div className="login-sculpture-stage">
            <div aria-hidden="true" className="login-sculpture-aura" />
            <div aria-hidden="true" className="login-sculpture-floor" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/visuals/login-logo-3d.webp"
              alt="智权链·锂安溯 立体磨砂玻璃徽标雕塑"
              width={792}
              height={817}
              className="login-sculpture-img h-[265px] w-auto object-contain select-none sm:h-[380px] lg:h-[min(41vw,73vh,590px)]"
            />
          </div>
        </div>
      </main>

      {/* Luxury 2-Column Frosted-Glass Identity Selection Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="identity-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#030811]/72 px-4 py-5 backdrop-blur-lg"
          onClick={e => {
            if (e.target === e.currentTarget && !enteringName) setModalOpen(false);
          }}
        >
          <div
            style={ORG_MODAL_TONES[selectedMsp]}
            className="identity-modal-shell animate-modal-in flex max-h-[90vh] w-full max-w-[740px] flex-col overflow-hidden rounded-[26px]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-sky-300/10 px-6 pt-6 pb-5 sm:px-7">
              <div>
                <h2 id="identity-modal-title" className="text-[18px] font-bold tracking-wide text-slate-50 sm:text-[19px]">
                  选择联盟身份
                </h2>
                <p className="mt-1 text-xs text-[#849db8]">
                  点选所属机构与业务岗位，一步进入对应工作台
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭窗口"
                disabled={Boolean(enteringName)}
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] border border-sky-300/16 bg-[#0f223a]/70 text-[#93adc8] transition hover:border-sky-300/35 hover:text-white disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 sm:px-7">
              {/* Deep-Link Guide Banner */}
              {deepLinkMeta && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-sky-400/30 bg-sky-500/12 px-4 py-3 text-xs text-sky-200">
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
                  className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-[15px] border border-sky-400/34 bg-gradient-to-r from-[#1d6ff2]/[0.16] to-teal-500/[0.14] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(186,230,253,0.14)] transition hover:border-sky-300/55 hover:from-[#1d6ff2]/[0.24] disabled:opacity-50"
                >
                  <div className="flex min-w-0 items-center gap-2.5 text-[13px] text-[#d6e6f7]">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#2dd4bf] shadow-[0_0_8px_#2dd4bf]" />
                    <span className="truncate">
                      上次登录：<strong className="font-bold text-white">{lastIdentity.roleLabel}</strong> ·{' '}
                      {lastIdentity.orgLabel.split(' ')[0]}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-[9px] border border-sky-300/38 bg-gradient-to-r from-[#1d6ff2]/28 to-teal-500/28 px-3 py-1 text-xs font-semibold text-[#a5f3fc] transition group-hover:brightness-115">
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
                          : 'border border-transparent text-[#849db8] hover:bg-sky-400/[0.06] hover:text-slate-200'
                      }`}
                    >
                      <span className="whitespace-nowrap">{ORG_TAB_NAMES[org.mspId]}</span>
                      {totalCount > 0 && (
                        <span
                          className={`mono rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                            active ? 'bg-teal-400/24 text-[#99f6e4]' : 'bg-slate-400/12 text-[#93adc8]'
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
                <p className="text-xs text-[#849db8]">{selectedOrgProfile.tagline}</p>

                <div className="inline-flex rounded-[10px] border border-sky-300/10 bg-[#040b15] p-[3px] text-[11.5px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setRoleScopeTab('core')}
                    className={`cursor-pointer rounded-[7px] px-2.5 py-1 transition ${
                      roleScopeTab === 'core'
                        ? 'border border-sky-300/22 bg-[#1e406e]/65 text-slate-50'
                        : 'border border-transparent text-[#849db8] hover:text-slate-200'
                    }`}
                  >
                    核心岗 ({orgIdentities.core.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoleScopeTab('all')}
                    className={`cursor-pointer rounded-[7px] px-2.5 py-1 transition ${
                      roleScopeTab === 'all'
                        ? 'border border-sky-300/22 bg-[#1e406e]/65 text-slate-50'
                        : 'border border-transparent text-[#849db8] hover:text-slate-200'
                    }`}
                  >
                    全部 ({orgIdentities.all.length})
                  </button>
                </div>
              </div>

              {/* 2-Column Luxury Layered Glass Role Cards */}
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
                        <div className="identity-role-icon flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[#7dd3fc]">
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
                              isHovered || isEntering ? 'text-[#a5f3fc]' : 'text-[#8ea6c2]'
                            }`}
                          >
                            {isEntering
                              ? `正在进入${destLabel}…`
                              : isHovered
                                ? `进入${destLabel} · ${summary}`
                                : summary}
                          </p>
                        </div>

                        <div className="identity-role-arrow flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[#6482a3]">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Minimal Security Footer */}
            <div className="flex items-center justify-between border-t border-sky-300/10 bg-[#040a14]/82 px-6 py-3.5 text-[11.5px] text-[#6482a3] sm:px-7">
              <span className="inline-flex items-center gap-1.5 text-[#93adc8]">
                <Lock className="h-3.5 w-3.5 text-[#38bdf8]" />
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
