'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  ArrowRight,
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
      {/* Minimalist Top Bar */}
      <header className="mx-auto flex h-20 w-full max-w-[1220px] items-center justify-between px-6 sm:px-10">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-mark.png"
            alt="智权链·锂安溯"
            width={34}
            height={34}
            className="h-8 w-8 object-contain select-none sm:h-[34px] sm:w-[34px]"
          />
          <span className="text-base font-bold tracking-wide text-white">智权链·锂安溯</span>
        </div>

        <nav aria-label="平台核心能力" className="hidden items-center gap-8 md:flex">
          {NAV_SHORTCUTS.map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => openPicker(item.msp)}
              className="cursor-pointer text-[13.5px] font-medium text-slate-400 transition hover:text-white"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => openPicker()}
          className="cursor-pointer rounded-xl bg-gradient-to-r from-[#2563eb] via-[#0ea5e9] to-[#10b981] px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_22px_-8px_rgba(14,165,233,0.65)] transition hover:brightness-110 active:scale-[0.98] sm:px-5 sm:py-2.5 sm:text-[13px]"
        >
          选择身份
        </button>
      </header>

      {/* Ultra-Clean 2-Column Hero Stage */}
      <main className="mx-auto grid w-full max-w-[1220px] flex-1 grid-cols-1 items-center gap-10 px-6 pt-4 pb-12 sm:px-10 lg:grid-cols-12 lg:gap-8 lg:py-0">
        {/* Left: Crisp Display Typography + Single Action */}
        <div className="order-2 flex flex-col items-start lg:order-1 lg:col-span-6">
          <h1 className="text-4xl leading-[1.12] font-extrabold tracking-tight text-white sm:text-5xl xl:text-[58px]">
            智权链 · 锂安溯
          </h1>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-200 sm:text-3xl xl:text-[34px]">
            - TrustGuard Battery -
          </p>

          <div className="mt-8 space-y-1.5">
            <p className="text-lg font-semibold text-[#2dd4bf] sm:text-[21px]">
              每一颗电芯，全周期可信。
            </p>
            <p className="text-[15px] leading-relaxed text-[#7c93aa] sm:text-[17px]">
              四方联盟多点背书。
            </p>
            <p className="text-[15px] leading-relaxed text-[#7c93aa] sm:text-[17px]">
              主动风控实时把关。
            </p>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => openPicker()}
              className="group inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-[#2563eb] via-[#0ea5e9] to-[#10b981] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_14px_32px_-10px_rgba(14,165,233,0.6)] transition hover:brightness-110 active:scale-[0.98]"
            >
              <span>选择身份登录</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            {lastIdentity && (
              <button
                type="button"
                disabled={Boolean(enteringName) || switching || loading}
                onClick={() => void loginWithIdentity(lastIdentity)}
                className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-slate-300 transition hover:text-[#2dd4bf] disabled:opacity-50"
              >
                {enteringName === lastIdentity.name ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#2dd4bf]" />
                ) : (
                  <History className="h-4 w-4 text-slate-400" />
                )}
                <span>继续上次：{lastIdentity.roleLabel}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: 3D Frosted-Glass Sculpture of the Official Brand Logo */}
        <div className="order-1 flex items-center justify-center lg:order-2 lg:col-span-6 lg:justify-end">
          <div className="animate-logo-float relative flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/visuals/login-logo-3d.jpg"
              alt="智权链·锂安溯 立体磨砂玻璃徽标雕塑"
              width={1024}
              height={1024}
              className="login-3d-blend h-[270px] w-[270px] object-contain select-none sm:h-[380px] sm:w-[380px] lg:h-[470px] lg:w-[470px] xl:h-[530px] xl:w-[530px]"
            />
          </div>
        </div>
      </main>

      {/* Connect-Wallet-Style Minimalist Identity Selection Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="identity-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#030812]/75 px-4 py-6 backdrop-blur-md"
          onClick={e => {
            if (e.target === e.currentTarget && !enteringName) setModalOpen(false);
          }}
        >
          <div className="animate-modal-in flex max-h-[88vh] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0c192b]/95 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.85)]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h2 id="identity-modal-title" className="text-base font-bold text-white">
                  选择联盟身份
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  点选所属机构与岗位，一步进入专属工作台
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭窗口"
                disabled={Boolean(enteringName)}
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              {/* Deep-Link Guide Banner */}
              {deepLinkMeta && (
                <div className="flex items-center gap-2 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3.5 py-2.5 text-xs text-sky-200">
                  <Compass className="h-4 w-4 shrink-0 text-sky-400" />
                  <span>
                    正在前往 <strong className="text-white">「{deepLinkMeta.label}」</strong>，选择有权限的岗位即可自动直达。
                  </span>
                </div>
              )}

              {/* Quick Resume Last Login */}
              {lastIdentity && (
                <button
                  type="button"
                  disabled={Boolean(enteringName) || switching || loading}
                  onClick={() => void loginWithIdentity(lastIdentity)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-teal-400/25 bg-teal-500/10 px-3.5 py-2.5 text-left text-xs transition hover:border-teal-400/50 hover:bg-teal-500/15 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 text-teal-200">
                    <History className="h-3.5 w-3.5 text-teal-300" />
                    <span>
                      上次登录：<strong className="text-white">{lastIdentity.roleLabel}</strong> ·{' '}
                      {lastIdentity.orgLabel.split(' ')[0]}
                    </span>
                  </div>
                  <span className="font-semibold text-teal-300">一键进入 →</span>
                </button>
              )}

              {/* 4-Organization Segmented Tabs */}
              <div>
                <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#07111e] p-1 sm:grid-cols-4">
                  {ORG_PROFILES.map(org => {
                    const active = selectedMsp === org.mspId;
                    return (
                      <button
                        key={org.mspId}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedMsp(org.mspId)}
                        className={`cursor-pointer rounded-lg px-2 py-2 text-xs font-semibold transition ${
                          active
                            ? 'bg-gradient-to-r from-[#2563eb]/90 to-[#0f9d8a]/90 text-white shadow-sm'
                            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                        }`}
                      >
                        {ORG_TAB_NAMES[org.mspId]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-slate-400">
                  {selectedOrgProfile.tagline}
                </p>
              </div>

              {/* Role Scope Filter + 1-Click Role List */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">选择岗位（点击即登录）</span>
                  <div className="inline-flex rounded-lg bg-[#07111e] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setRoleScopeTab('core')}
                      className={`cursor-pointer rounded-md px-2.5 py-1 font-medium transition ${
                        roleScopeTab === 'core' ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      核心 ({orgIdentities.core.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleScopeTab('all')}
                      className={`cursor-pointer rounded-md px-2.5 py-1 font-medium transition ${
                        roleScopeTab === 'all' ? 'bg-white/12 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      全部 ({orgIdentities.all.length})
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="skeleton-block-dark h-[64px]" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleRoles.map(item => {
                      const RoleIcon = ROLE_ICONS[item.role] ?? UserCheck;
                      const isEntering = enteringName === item.name;
                      const destHref =
                        deepLinkPath && canAccessRoute(item, deepLinkPath)
                          ? deepLinkPath
                          : getDefaultRouteForActor(item);
                      const destLabel = findRouteMeta(destHref)?.label ?? '工作台';
                      return (
                        <button
                          key={item.name}
                          type="button"
                          disabled={Boolean(enteringName) || switching}
                          onClick={() => void loginWithIdentity(item)}
                          className="group flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-sky-400/50 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/12 text-sky-300 transition group-hover:bg-sky-500/20 group-hover:text-teal-300">
                            {isEntering ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RoleIcon className="h-4 w-4" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[13.5px] font-bold text-white">
                                {item.roleLabel}
                              </span>
                              <span className="shrink-0 text-[11px] font-medium text-teal-300/90 opacity-80 transition group-hover:opacity-100">
                                {isEntering ? '正在进入…' : `进入${destLabel} →`}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-400">
                              {getRoleSummaryForIdentity(item)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Minimal Security Footer */}
            <div className="flex items-center justify-between border-t border-white/10 bg-[#081322]/90 px-6 py-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-teal-400" />
                服务端安全托管身份 · 零前端私钥
              </span>
              <span className="mono text-slate-500">GB/T 34014</span>
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
