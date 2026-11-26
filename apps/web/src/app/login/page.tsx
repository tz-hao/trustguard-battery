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
      {/* Full-Bleed Edge-to-Edge Top Bar */}
      <header className="flex h-20 w-full shrink-0 items-center justify-between px-6 sm:h-[88px] sm:px-10 lg:px-16">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-mark.png"
            alt="智权链·锂安溯"
            width={42}
            height={42}
            className="h-9 w-9 object-contain drop-shadow-[0_4px_14px_rgba(20,184,166,0.32)] select-none sm:h-[42px] sm:w-[42px]"
          />
          <span className="text-lg font-bold tracking-wide text-slate-50 sm:text-[19px]">
            智权链·锂安溯
          </span>
        </div>

        <nav aria-label="平台核心能力" className="hidden items-center gap-9 md:flex lg:gap-11">
          {NAV_SHORTCUTS.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => openPicker(item.msp)}
              className="cursor-pointer text-[14.5px] font-medium text-slate-400 transition hover:text-white"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => openPicker()}
          className="crystal-cta-sm cursor-pointer rounded-xl px-4 py-2 text-[13px] font-semibold tracking-wide text-white active:scale-[0.98] sm:px-5 sm:py-2.5 sm:text-sm"
        >
          选择身份
        </button>
      </header>

      {/* Full-Screen Responsive 2-Column Hero Stage */}
      <main className="mx-auto grid w-full max-w-[1680px] flex-1 grid-cols-1 items-center gap-8 px-6 pt-2 pb-10 sm:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:px-20 lg:pt-0 lg:pb-7 xl:px-24">
        {/* Left: Viewport-Scaled Display Typography + Crystal Buttons */}
        <div className="order-2 flex flex-col items-start lg:order-1 lg:-mt-4">
          <h1
            style={{ fontSize: 'clamp(2.5rem, 5.1vw, 4.75rem)' }}
            className="leading-[1.08] font-extrabold tracking-tight text-white"
          >
            智权链 · 锂安溯
          </h1>
          <p
            style={{ fontSize: 'clamp(1.5rem, 2.9vw, 2.65rem)' }}
            className="mt-3.5 font-bold tracking-tight text-slate-200 sm:mt-4"
          >
            - TrustGuard Battery -
          </p>

          <div className="mt-7 space-y-2 sm:mt-9">
            <p
              style={{ fontSize: 'clamp(1.15rem, 1.72vw, 1.56rem)' }}
              className="font-bold tracking-wide text-[#2dd4bf]"
            >
              每一颗电芯，全周期可信。
            </p>
            <p
              style={{ fontSize: 'clamp(1rem, 1.45vw, 1.32rem)' }}
              className="leading-snug font-medium text-[#7089a4]"
            >
              四方联盟多点背书。
            </p>
            <p
              style={{ fontSize: 'clamp(1rem, 1.45vw, 1.32rem)' }}
              className="leading-snug font-medium text-[#7089a4]"
            >
              主动风控实时把关。
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4 sm:mt-11">
            <button
              type="button"
              onClick={() => openPicker()}
              className="crystal-cta-lg group inline-flex cursor-pointer items-center gap-2.5 rounded-[14px] px-7 py-3.5 text-base font-bold tracking-wide text-white active:scale-[0.98] sm:px-8 sm:py-4 sm:text-[17px]"
            >
              <span>选择身份登录</span>
              <ArrowRight className="h-[18px] w-[18px] transition-transform duration-150 group-hover:translate-x-0.5" />
            </button>

            {lastIdentity && (
              <button
                type="button"
                disabled={Boolean(enteringName) || switching || loading}
                onClick={() => void loginWithIdentity(lastIdentity)}
                className="glass-ghost-btn inline-flex cursor-pointer items-center gap-2 rounded-[14px] px-5 py-3.5 text-sm font-semibold text-slate-300 active:scale-[0.98] disabled:opacity-50 sm:py-4 sm:text-[15px]"
              >
                {enteringName === lastIdentity.name ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#2dd4bf]" />
                ) : (
                  <History className="h-4 w-4 text-slate-400" />
                )}
                <span className="whitespace-nowrap">继续上次：{lastIdentity.roleLabel}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Grounded True-Transparent 3D Frosted-Glass Sculpture in Shared Studio Light */}
        <div className="order-1 flex items-center justify-center lg:order-2 lg:justify-end">
          <div className="login-sculpture-stage">
            <div aria-hidden="true" className="login-sculpture-aura" />
            <div aria-hidden="true" className="login-sculpture-floor" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/visuals/login-logo-3d.webp"
              alt="智权链·锂安溯 立体磨砂玻璃徽标雕塑"
              width={792}
              height={817}
              className="login-sculpture-img h-[260px] w-auto object-contain select-none sm:h-[370px] lg:h-[min(43vw,580px)]"
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
          <div className="identity-modal-shell animate-modal-in flex max-h-[90vh] w-full max-w-[740px] flex-col overflow-hidden rounded-[26px]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/[0.07] px-6 pt-6 pb-5 sm:px-7">
              <div>
                <h2 id="identity-modal-title" className="text-[18px] font-bold tracking-wide text-white sm:text-[19px]">
                  选择联盟身份
                </h2>
                <p className="mt-1 text-xs text-[#8da2b8]">
                  点选所属机构与业务岗位，一步进入对应工作台
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭窗口"
                disabled={Boolean(enteringName)}
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.05] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
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
                  className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-[15px] border border-teal-400/32 bg-gradient-to-r from-teal-500/[0.14] to-sky-500/[0.08] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-teal-300/55 hover:from-teal-500/[0.2] disabled:opacity-50"
                >
                  <div className="flex min-w-0 items-center gap-2.5 text-[13px] text-slate-300">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#2dd4bf] shadow-[0_0_8px_#2dd4bf]" />
                    <span className="truncate">
                      上次登录：<strong className="font-bold text-white">{lastIdentity.roleLabel}</strong> ·{' '}
                      {lastIdentity.orgLabel.split(' ')[0]}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-[9px] border border-teal-300/35 bg-teal-400/18 px-3 py-1 text-xs font-semibold text-[#5eead4] transition group-hover:bg-teal-400/28">
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
                          : 'border border-transparent text-[#8da2b8] hover:bg-white/[0.04] hover:text-slate-200'
                      }`}
                    >
                      <span className="whitespace-nowrap">{ORG_TAB_NAMES[org.mspId]}</span>
                      {totalCount > 0 && (
                        <span
                          className={`mono rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                            active ? 'bg-teal-400/20 text-[#5eead4]' : 'bg-white/[0.07] text-slate-400'
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
                <p className="text-xs text-[#7e95ad]">{selectedOrgProfile.tagline}</p>

                <div className="inline-flex rounded-[10px] border border-white/[0.07] bg-[#060e1a] p-[3px] text-[11.5px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setRoleScopeTab('core')}
                    className={`cursor-pointer rounded-[7px] px-2.5 py-1 transition ${
                      roleScopeTab === 'core' ? 'bg-white/10 text-white' : 'text-[#7e95ad] hover:text-slate-200'
                    }`}
                  >
                    核心岗 ({orgIdentities.core.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoleScopeTab('all')}
                    className={`cursor-pointer rounded-[7px] px-2.5 py-1 transition ${
                      roleScopeTab === 'all' ? 'bg-white/10 text-white' : 'text-[#7e95ad] hover:text-slate-200'
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
                              isHovered || isEntering ? 'text-[#99f6e4]' : 'text-[#8da2b8]'
                            }`}
                          >
                            {isEntering
                              ? `正在进入${destLabel}…`
                              : isHovered
                                ? `进入${destLabel} · ${summary}`
                                : summary}
                          </p>
                        </div>

                        <div className="identity-role-arrow flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-slate-500">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Minimal Security Footer */}
            <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#050c16]/75 px-6 py-3.5 text-[11.5px] text-slate-500 sm:px-7">
              <span className="inline-flex items-center gap-1.5 text-slate-400">
                <Lock className="h-3.5 w-3.5 text-[#2dd4bf]" />
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
