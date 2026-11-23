'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeftRight,
  Bell,
  Building2,
  ClipboardCheck,
  Cpu,
  Eye,
  FileSearch,
  FlaskConical,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  Search,
  Shield,
  X,
} from 'lucide-react';
import { useIdentity } from './IdentityProvider';
import { useToast } from './ToastProvider';
import { OrgBadge } from './Badges';
import { TrustGuardBrandLogo } from './Visuals';
import { LoginPortal } from '@/app/login/page';
import { ORG_LABELS } from '@/lib/types';
import {
  ALL_ROUTES,
  CORE_IDENTITY_NAMES,
  canAccessRoute,
  getAllowedRoutes,
  getDefaultRouteForActor,
  type RoutePath,
} from '@/lib/permissions';

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

const ORG_AVATAR: Record<string, { char: string; bg: string }> = {
  CellOrgMSP: { char: '电', bg: 'bg-brand' },
  PackOrgMSP: { char: '装', bg: 'bg-teal' },
  LabOrgMSP: { char: '检', bg: 'bg-info' },
  RecycleOrgMSP: { char: '回', bg: 'bg-success' },
};

interface HeaderTelemetry {
  alertsCount: number;
  recentRejections: { requestId: string; action: string; errorCode: string | null }[];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { notify } = useToast();
  const {
    actor,
    identities,
    authenticated,
    loading: identityLoading,
    switching,
    roleScoped,
    setRoleScoped,
    presentationMode,
    setPresentationMode,
    switchActor,
    logout,
  } = useIdentity();

  const [quickCode, setQuickCode] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<HeaderTelemetry>({
    alertsCount: 0,
    recentRejections: [],
  });
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setNotifOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen]);

  useEffect(() => {
    if (!actor?.name || !authenticated || pathname === '/login') return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/bff/dashboard', { cache: 'no-store' });
        if (!active || !res.ok) return;
        const json = (await res.json()) as {
          summary?: { rejectedTxCount?: number; rejectedAssets?: number };
          recentRejections?: { requestId: string; action: string; errorCode: string | null }[];
        };
        setTelemetry({
          alertsCount: (json.summary?.rejectedTxCount ?? 0) + (json.summary?.rejectedAssets ?? 0),
          recentRejections: json.recentRejections?.slice(0, 5) ?? [],
        });
      } catch {
        // ignore telemetry errors
      }
    })();
    return () => {
      active = false;
    };
  }, [pathname, actor?.name, authenticated]);

  const allowedSet = useMemo(() => new Set<RoutePath>(getAllowedRoutes(actor)), [actor]);

  const permittedGroups = useMemo(() => {
    const groupsMap = new Map<string, typeof ALL_ROUTES>();
    for (const route of ALL_ROUTES) {
      if (!roleScoped || allowedSet.has(route.href)) {
        const list = groupsMap.get(route.group) ?? [];
        list.push(route);
        groupsMap.set(route.group, list);
      }
    }
    return Array.from(groupsMap.entries()).map(([group, items]) => ({ group, items }));
  }, [allowedSet, roleScoped]);

  const roleFilteredGroups = useMemo(() => {
    const groupsMap = new Map<string, typeof ALL_ROUTES>();
    for (const route of ALL_ROUTES) {
      if (allowedSet.has(route.href)) {
        const list = groupsMap.get(route.group) ?? [];
        list.push(route);
        groupsMap.set(route.group, list);
      }
    }
    return Array.from(groupsMap.entries()).map(([group, items]) => ({ group, items }));
  }, [allowedSet]);

  const groupedIdentities = useMemo(() => {
    const coreByOrg: Record<string, typeof identities> = {};
    const aux: typeof identities = [];
    for (const item of identities) {
      if (CORE_IDENTITY_NAMES.has(item.name)) {
        (coreByOrg[item.mspId] ??= []).push(item);
      } else {
        aux.push(item);
      }
    }
    return { coreByOrg, aux };
  }, [identities]);

  // Explicit /login route -> always show full-screen LoginPortal
  if (pathname === '/login') {
    return <LoginPortal />;
  }

  // Strict Session Gate: NEVER flash backend workspace before session verification finishes
  if (identityLoading) {
    return (
      <div className="login-tech-canvas flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-white">
        <TrustGuardBrandLogo size="lg" className="logo-breathing-halo" />
        <div className="text-center">
          <div className="text-base font-bold tracking-wide">智权链 · 锂安溯</div>
          <div className="mt-1 text-xs text-slate-300">正在核验当前会话身份...</div>
        </div>
      </div>
    );
  }

  // Unauthenticated visit to any route -> render LoginPortal directly
  if (!authenticated) {
    return <LoginPortal />;
  }

  const currentLocation =
    ALL_ROUTES.find(item => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))) ??
    ALL_ROUTES[0];

  const routeBlocked = roleScoped && Boolean(actor) && !canAccessRoute(actor, pathname);
  const displayedGroups = roleFilteredGroups.length > 0 ? roleFilteredGroups : permittedGroups;
  const avatarMeta = ORG_AVATAR[actor?.mspId ?? ''] ?? { char: '链', bg: 'bg-brand' };

  function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = quickCode.trim().toUpperCase();
    if (!cleaned) return;
    router.push(`/identity?code=${encodeURIComponent(cleaned)}`);
  }

  async function handleLogout() {
    setMobileNavOpen(false);
    await logout();
    notify({ tone: 'info', title: '已退出当前岗位', description: '请重新选择企业与岗位登录' });
    router.push('/login');
  }

  function renderSidebarBody(collapsed: boolean) {
    return (
      <div className="flex h-full flex-col justify-between border-r border-[#1a3454] bg-gradient-to-b from-[#071324] via-[#0c1e34] to-[#081526] text-slate-200">
        <div className="overflow-y-auto">
          <div
            className={`flex items-center border-b border-[#1a3454] py-4 ${
              collapsed ? 'justify-center px-2' : 'justify-between gap-2 px-4'
            }`}
          >
            <Link
              href={getDefaultRouteForActor(actor)}
              onClick={() => setMobileNavOpen(false)}
              className="flex min-w-0 items-center gap-2.5"
              title="智权链 · 锂安溯"
            >
              <TrustGuardBrandLogo size="sm" />
              {!collapsed && (
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold tracking-wide text-white">智权链 · 锂安溯</div>
                  <div className="truncate text-[11px] font-medium text-teal-300">动力电池溯源工作台</div>
                </div>
              )}
            </Link>
            {!collapsed && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                title="收起侧边栏"
                aria-label="收起侧边栏"
                className="hidden cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white lg:inline-flex"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <div className="mt-2 hidden justify-center lg:flex">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                title="展开侧边栏"
                aria-label="展开侧边栏"
                className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          )}

          <nav className={`space-y-4 ${collapsed ? 'p-2' : 'p-3'}`} aria-label="主导航">
            {displayedGroups.map(section => (
              <div key={section.group}>
                {!collapsed && (
                  <div className="mb-1.5 px-3 text-[11px] font-semibold tracking-wide text-slate-400">
                    {section.group}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map(item => {
                    const Icon = ROUTE_ICONS[item.href];
                    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        onClick={() => setMobileNavOpen(false)}
                        className={`group relative flex items-center rounded-xl py-2.5 text-[13px] font-medium transition ${
                          collapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
                        } ${
                          active
                            ? 'bg-gradient-to-r from-brand to-brand/80 text-white shadow-md shadow-brand/25'
                            : 'text-slate-300 hover:bg-[#152f4c] hover:text-white'
                        }`}
                      >
                        {active && (
                          <span className="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-sky-300 to-teal-300" />
                        )}
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
                            active ? 'text-white' : 'text-slate-400 group-hover:translate-x-0.5 group-hover:text-teal-300'
                          }`}
                        />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Current Role Card & Logout / Switch Role Button */}
        <div
          className={`m-3 rounded-2xl border border-[#1d3958] bg-[#071323]/95 text-xs text-slate-300 ${
            collapsed ? 'p-2' : 'space-y-2.5 p-3'
          }`}
        >
          {actor && (
            <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
              <div className="relative shrink-0">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${avatarMeta.bg}`}
                >
                  {avatarMeta.char}
                </div>
                <span className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-[#071323] bg-emerald-400" />
                </span>
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="truncate font-bold text-white">{actor.roleLabel}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">{actor.orgLabel.split(' ')[0]}</div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            title="切换角色 / 退出登录"
            className={`inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#23456d] bg-[#10243a] text-xs font-semibold text-white transition hover:border-teal-400/50 hover:bg-[#17324f] ${
              collapsed ? 'mt-2 p-2' : 'px-3 py-2'
            }`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0 text-teal-300" />
            {!collapsed && <span>切换角色 / 退出登录</span>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen text-ink">
      {/* Desktop Collapsible Sidebar (248px <-> 76px), auto-hidden in Big-Screen Mode */}
      <aside
        className={`presentation-sidebar-hide sticky top-0 hidden h-screen shrink-0 transition-[width] duration-200 lg:block ${
          sidebarCollapsed ? 'w-[76px]' : 'w-[248px]'
        }`}
      >
        {renderSidebarBody(sidebarCollapsed)}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-[248px] shrink-0">{renderSidebarBody(false)}</div>
          <div className="flex-1 bg-[#06101e]/65 backdrop-blur-[2px]" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar (64px) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line/85 bg-white/88 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="cursor-pointer rounded-lg border border-line p-1.5 text-ink hover:bg-subtle lg:hidden"
              aria-label="打开菜单"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="hidden items-center gap-2 text-xs sm:flex">
              <span className="text-ink-secondary">{currentLocation.group}</span>
              <span className="text-ink-muted">/</span>
              <span className="font-bold text-navy-900">{currentLocation.label}</span>
            </div>

            <form onSubmit={handleQuickSearch} className="hidden items-center gap-1.5 md:flex">
              <div className="relative w-56 transition-[width] duration-200 focus-within:w-72 xl:w-64 xl:focus-within:w-80">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-ink-muted" />
                <input
                  type="text"
                  value={quickCode}
                  onChange={e => setQuickCode(e.target.value.toUpperCase())}
                  placeholder="快速检索 24 位电池编码..."
                  className="mono w-full rounded-xl border border-line bg-canvas py-1.5 pr-6 pl-8 text-xs text-ink outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
                />
                {quickCode && (
                  <button
                    type="button"
                    onClick={() => setQuickCode('')}
                    aria-label="清空编码"
                    className="absolute top-2 right-2 cursor-pointer text-ink-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="cursor-pointer rounded-xl bg-brand px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-brand-hover"
              >
                查询
              </button>
            </form>
          </div>

          {/* Right Tools & Current Role */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !presentationMode;
                setPresentationMode(next);
                notify({
                  tone: 'info',
                  title: next ? '已开启大屏演示模式' : '已退出大屏演示模式',
                  description: next ? '已隐藏侧边栏并放大视图字号' : '已恢复标准工作台布局',
                });
              }}
              title={presentationMode ? '退出大屏模式' : '开启大屏模式'}
              className={`hidden cursor-pointer items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition xl:inline-flex ${
                presentationMode
                  ? 'border-brand bg-brand text-white shadow-xs'
                  : 'border-line bg-canvas text-ink-secondary hover:bg-subtle hover:text-ink'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>{presentationMode ? '退出大屏' : '大屏'}</span>
            </button>

            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen(v => !v)}
                className="relative cursor-pointer rounded-xl border border-line bg-canvas p-2 text-ink transition hover:bg-subtle"
                aria-label="安全通知"
                aria-expanded={notifOpen}
              >
                <Bell className="h-4 w-4" />
                {telemetry.alertsCount > 0 && (
                  <span className="mono absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white shadow-xs">
                    {telemetry.alertsCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="animate-page-in absolute right-0 mt-2 w-80 rounded-2xl border border-line bg-white p-3.5 shadow-xl">
                  <div className="mb-2.5 flex items-center justify-between text-xs font-bold text-ink">
                    <span>安全拦截与告警通知</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="cursor-pointer text-ink-secondary hover:text-ink"
                    >
                      关闭
                    </button>
                  </div>
                  {telemetry.recentRejections.length === 0 ? (
                    <div className="py-4 text-center text-xs text-ink-secondary">暂无最新告警</div>
                  ) : (
                    <div className="space-y-1.5">
                      {telemetry.recentRejections.map(r => (
                        <div
                          key={r.requestId}
                          className="rounded-xl border border-danger/25 bg-danger/5 px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between font-semibold text-ink">
                            <span>{r.action}</span>
                            <span className="mono text-[11px] text-danger">{r.errorCode ?? 'REJECTED'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Role Selector */}
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-subtle/80 px-2.5 py-1.5">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-brand" />
              {actor && (
                <span className="hidden sm:inline-flex">
                  <OrgBadge mspId={actor.mspId} />
                </span>
              )}
              <select
                aria-label="切换服务端 mTLS 白名单身份"
                disabled={switching || identities.length === 0}
                value={actor?.name ?? ''}
                onChange={e => {
                  if (e.target.value) {
                    const nextId = identities.find(i => i.name === e.target.value);
                    void switchActor(e.target.value);
                    if (nextId) {
                      notify({
                        tone: 'info',
                        title: `已切换身份：${nextId.roleLabel}`,
                        description: nextId.orgLabel.split(' ')[0],
                      });
                    }
                  }
                }}
                className="max-w-[140px] cursor-pointer truncate bg-transparent text-xs font-semibold text-ink outline-none sm:max-w-[190px]"
              >
                {!actor && <option value="">加载中...</option>}
                {Object.entries(groupedIdentities.coreByOrg).map(([msp, items]) => (
                  <optgroup key={`core-${msp}`} label={ORG_LABELS[msp]?.split(' ')[0] ?? msp}>
                    {items.map(item => (
                      <option key={item.name} value={item.name}>
                        {item.roleLabel} ({item.name})
                      </option>
                    ))}
                  </optgroup>
                ))}
                {groupedIdentities.aux.length > 0 && (
                  <optgroup label="其他岗位角色">
                    {groupedIdentities.aux.map(item => (
                      <option key={item.name} value={item.name}>
                        {item.roleLabel} ({item.name})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6">
          <div key={pathname} className="animate-page-in">
            {routeBlocked && actor ? (
              <div className="mx-auto my-8 max-w-xl">
                <div className="card-surface card-accent-amber space-y-4 p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h1 className="text-base font-bold text-ink">当前岗位无权访问「{currentLocation.label}」</h1>
                      <p className="text-xs leading-relaxed text-ink-secondary">
                        您当前登录身份为{' '}
                        <strong className="text-ink">
                          {actor.orgLabel.split(' ')[0]} · {actor.roleLabel}
                        </strong>
                        ，请前往您的岗位工作台或切换登录角色。
                      </p>
                    </div>
                  </div>

                  <div className="subtle-surface p-3.5">
                    <div className="mb-2 text-xs font-semibold text-ink-secondary">当前岗位可用模块：</div>
                    <div className="flex flex-wrap gap-2">
                      {ALL_ROUTES.filter(r => allowedSet.has(r.href)).map(r => (
                        <Link
                          key={r.href}
                          href={r.href}
                          className="rounded-lg border border-brand/30 bg-white px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white"
                        >
                          前往 {r.label}
                        </Link>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      切换登录角色
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoleScoped(false)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-xs font-semibold text-ink-secondary hover:border-brand/40 hover:text-ink"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      临时切换至全局演示视图
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
