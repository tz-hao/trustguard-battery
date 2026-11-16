'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeftRight,
  Bell,
  Building2,
  ClipboardCheck,
  Cpu,
  FileSearch,
  FlaskConical,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Menu,
  QrCode,
  Search,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useIdentity } from './IdentityProvider';
import { OrgBadge } from './Badges';
import { ORG_LABELS } from '@/lib/types';

const NAV_GROUPS = [
  {
    group: '工作台',
    items: [{ href: '/', code: '01', label: '安全驾驶舱', icon: LayoutDashboard }],
  },
  {
    group: '电池管理',
    items: [
      { href: '/identity', code: '02', label: '电池数字身份', icon: QrCode },
      { href: '/inspections', code: '03', label: '质量检测中心', icon: Activity },
      { href: '/trace', code: '04', label: '电池谱系追溯', icon: GitBranch },
    ],
  },
  {
    group: '企业协作',
    items: [
      { href: '/approvals', code: '05', label: '联合审批中心', icon: ClipboardCheck },
      { href: '/transfers', code: '06', label: '企业交接管理', icon: ArrowLeftRight },
    ],
  },
  {
    group: '智能风控',
    items: [
      { href: '/risk', code: '07', label: 'AI 风险分析', icon: Cpu },
      { href: '/policies', code: '08', label: '安全策略管理', icon: Shield },
    ],
  },
  {
    group: '区块链安全',
    items: [
      { href: '/lab', code: '09', label: '安全攻防实验室', icon: FlaskConical },
      { href: '/audit', code: '10', label: '区块链审计中心', icon: FileSearch },
    ],
  },
  {
    group: '系统管理',
    items: [{ href: '/organizations', code: '11', label: '组织与权限管理', icon: Building2 }],
  },
];

interface HeaderTelemetry {
  ledgerHeight?: string;
  apiOk: boolean;
  alertsCount: number;
  recentRejections: { requestId: string; action: string; errorCode: string | null }[];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { actor, identities, switching, switchActor } = useIdentity();
  const [quickCode, setQuickCode] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<HeaderTelemetry>({ apiOk: true, alertsCount: 0, recentRejections: [] });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/bff/dashboard', { cache: 'no-store' });
        if (!active) return;
        if (res.ok) {
          const json = (await res.json()) as {
            summary?: { ledgerHeight?: string; rejectedTxCount?: number; rejectedAssets?: number };
            recentRejections?: { requestId: string; action: string; errorCode: string | null }[];
          };
          setTelemetry({
            apiOk: true,
            ledgerHeight: json.summary?.ledgerHeight,
            alertsCount: (json.summary?.rejectedTxCount ?? 0) + (json.summary?.rejectedAssets ?? 0),
            recentRejections: json.recentRejections?.slice(0, 5) ?? [],
          });
        } else {
          setTelemetry(t => ({ ...t, apiOk: false }));
        }
      } catch {
        if (active) setTelemetry(t => ({ ...t, apiOk: false }));
      }
    })();
    return () => {
      active = false;
    };
  }, [pathname, actor?.name]);

  const grouped = identities.reduce<Record<string, typeof identities>>((acc, item) => {
    (acc[item.mspId] ??= []).push(item);
    return acc;
  }, {});

  const currentLocation = (() => {
    for (const grp of NAV_GROUPS) {
      for (const item of grp.items) {
        const match = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        if (match) return { group: grp.group, label: item.label, code: item.code };
      }
    }
    return { group: '工作台', label: '安全驾驶舱', code: '01' };
  })();

  function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = quickCode.trim().toUpperCase();
    if (!cleaned) return;
    router.push(`/identity?code=${encodeURIComponent(cleaned)}`);
  }

  const sidebarBody = (
    <div className="flex h-full flex-col justify-between bg-[#10243A] text-slate-200">
      <div className="overflow-y-auto">
        <div className="border-b border-[#1d3958] px-5 py-4">
          <Link href="/" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563EB] text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-wide text-white">智权链 · 锂安溯</div>
              <div className="mono text-[10px] tracking-wider text-[#0F9D8A]">TRUSTGUARD BATTERY</div>
            </div>
          </Link>
        </div>

        <nav className="space-y-4 p-3">
          {NAV_GROUPS.map(section => (
            <div key={section.group}>
              <div className="mb-1.5 px-3 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {section.items.map(item => {
                  const Icon = item.icon;
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={`group flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                        active
                          ? 'bg-[#2563EB] text-white'
                          : 'text-slate-300 hover:bg-[#17324f] hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
                        <span>{item.label}</span>
                      </span>
                      <span className={`mono text-[10px] ${active ? 'text-blue-100' : 'text-slate-500'}`}>{item.code}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="m-3 space-y-2 rounded-xl border border-[#1d3958] bg-[#0B192C] p-3 text-[11px] text-slate-300">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white">Fabric 2.5.16</span>
          <span className="inline-flex items-center gap-1.5 text-[#159B76]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#159B76]" />
            4 Org 在线
          </span>
        </div>
        <div className="mono text-[10px] text-slate-400">batterybusiness · battery v1.3</div>
        <div className="rounded bg-[#D99A2B]/15 px-2 py-1 text-[10px] font-medium text-amber-200">
          四川竞赛场景 · 显式模拟数据
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F4F7FA] text-[#172B3A]">
      {/* Desktop Sidebar (240px) */}
      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 lg:block">{sidebarBody}</aside>

      {/* Mobile Drawer Sidebar */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-[240px] shrink-0">{sidebarBody}</div>
          <div className="flex-1 bg-[#0B192C]/50" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar (64px) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#dce4ee] bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg border border-[#dce4ee] p-1.5 text-[#172B3A] lg:hidden"
              aria-label="打开菜单"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="hidden items-center gap-2 text-xs sm:flex">
              <span className="text-[#64748B]">{currentLocation.group}</span>
              <span className="text-[#94A3B8]">/</span>
              <span className="font-bold text-[#10243A]">
                {currentLocation.code}. {currentLocation.label}
              </span>
            </div>

            <form onSubmit={handleQuickSearch} className="hidden items-center gap-1.5 md:flex">
              <div className="relative w-64 xl:w-72">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[#94A3B8]" />
                <input
                  type="text"
                  value={quickCode}
                  onChange={e => setQuickCode(e.target.value.toUpperCase())}
                  placeholder="快速检索 24 位 GB/T 34014 编码..."
                  className="mono w-full rounded-lg border border-[#dce4ee] bg-[#F4F7FA] py-1.5 pr-6 pl-8 text-xs text-[#172B3A] outline-none focus:border-[#2563EB] focus:bg-white"
                />
                {quickCode && (
                  <button
                    type="button"
                    onClick={() => setQuickCode('')}
                    className="absolute top-2 right-2 text-[#94A3B8] hover:text-[#172B3A]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="rounded-lg bg-[#2563EB] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                查询
              </button>
            </form>
          </div>

          {/* Right Status + Notifications + Identity Switcher */}
          <div className="flex items-center gap-2.5">
            <div className="hidden items-center gap-2 rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1 text-[11px] xl:flex">
              <span className="inline-flex items-center gap-1 font-medium text-[#159B76]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#159B76]" />
                Fabric {telemetry.ledgerHeight ? `#${telemetry.ledgerHeight}` : '在线'}
              </span>
              <span className="text-[#dce4ee]">|</span>
              <span className={`font-medium ${telemetry.apiOk ? 'text-[#0F9D8A]' : 'text-[#DC5353]'}`}>
                mTLS API {telemetry.apiOk ? '正常' : '异常'}
              </span>
            </div>

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(v => !v)}
                className="relative rounded-lg border border-[#dce4ee] bg-[#F4F7FA] p-2 text-[#172B3A] hover:bg-[#EDF2F7]"
                aria-label="安全通知"
              >
                <Bell className="h-4 w-4" />
                {telemetry.alertsCount > 0 && (
                  <span className="mono absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#DC5353] px-1 text-[9px] font-bold text-white">
                    {telemetry.alertsCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-[#dce4ee] bg-white p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-[#172B3A]">
                    <span>安全拦截与告警通知</span>
                    <button onClick={() => setNotifOpen(false)} className="text-[#64748B] hover:text-[#172B3A]">
                      关闭
                    </button>
                  </div>
                  {telemetry.recentRejections.length === 0 ? (
                    <div className="py-4 text-center text-xs text-[#64748B]">暂无最新安全拦截</div>
                  ) : (
                    <div className="space-y-1.5">
                      {telemetry.recentRejections.map(r => (
                        <div key={r.requestId} className="rounded-lg border border-[#DC5353]/25 bg-[#DC5353]/5 px-2.5 py-2 text-[11px]">
                          <div className="flex items-center justify-between font-semibold text-[#172B3A]">
                            <span>{r.action}</span>
                            <span className="mono text-[#DC5353]">{r.errorCode ?? 'REJECTED'}</span>
                          </div>
                          <div className="mono text-[10px] text-[#64748B]">{r.requestId}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Server Whitelist mTLS Identity Switcher */}
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[#dce4ee] bg-[#EDF2F7] px-2.5 py-1.5">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
              {actor && (
                <span className="hidden sm:inline-flex">
                  <OrgBadge mspId={actor.mspId} />
                </span>
              )}
              <select
                aria-label="切换服务端 mTLS 白名单身份"
                disabled={switching || identities.length === 0}
                value={actor?.name ?? 'cell-viewer'}
                onChange={e => void switchActor(e.target.value)}
                className="max-w-[165px] truncate bg-transparent text-xs font-semibold text-[#172B3A] outline-none sm:max-w-[230px]"
              >
                {Object.entries(grouped).map(([msp, items]) => (
                  <optgroup key={msp} label={ORG_LABELS[msp] ?? msp}>
                    {items.map(item => (
                      <option key={item.name} value={item.name}>
                        {item.name} · {item.roleLabel}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
