'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldAlert, Wrench } from 'lucide-react';
import {
  LifecycleBadge,
  OrgBadge,
  SectionHeader,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { useIdentity } from '@/components/IdentityProvider';
import type { BatteryAssetView } from '@/lib/types';

interface LifecycleEventOption {
  value: string;
  label: string;
  requiredRole: 'operator' | 'recycler';
  allowedOrgs: string[];
  requiredRoleHint: string;
  validStates: string[];
}

const LIFECYCLE_EVENTS: LifecycleEventOption[] = [
  {
    value: 'installations',
    label: '装车登记 (RecordInstallation · PackOrg operator)',
    requiredRole: 'operator',
    allowedOrgs: ['PackOrgMSP'],
    requiredRoleHint: 'pack-operator',
    validStates: ['RELEASED'],
  },
  {
    value: 'first-use',
    label: '首次投入使用 (RecordFirstUse · PackOrg operator)',
    requiredRole: 'operator',
    allowedOrgs: ['PackOrgMSP'],
    requiredRoleHint: 'pack-operator',
    validStates: ['INSTALLED'],
  },
  {
    value: 'retirements',
    label: '退役登记 (RecordRetirement · 持有方 operator)',
    requiredRole: 'operator',
    allowedOrgs: ['PackOrgMSP', 'CellOrgMSP'],
    requiredRoleHint: 'pack-operator',
    validStates: ['RELEASED', 'INSTALLED', 'IN_USE'],
  },
  {
    value: 'recycling-receipts',
    label: '回收接收确认 (ConfirmRecycling · RecycleOrg recycler)',
    requiredRole: 'recycler',
    allowedOrgs: ['RecycleOrgMSP'],
    requiredRoleHint: 'recycle-recycler',
    validStates: ['RETIRED'],
  },
  {
    value: 'scrap-confirmations',
    label: '正式报废确认 (RecordScrapConfirmation · RecycleOrg recycler)',
    requiredRole: 'recycler',
    allowedOrgs: ['RecycleOrgMSP'],
    requiredRoleHint: 'recycle-recycler',
    validStates: ['RECEIVED_FOR_RECYCLING'],
  },
];

function inferNextEvent(target: BatteryAssetView | null): string {
  if (!target) return 'installations';
  if (target.state === 'INSTALLED') return 'first-use';
  if (target.state === 'IN_USE') return 'retirements';
  if (target.state === 'RETIRED') return 'recycling-receipts';
  if (target.state === 'RECEIVED_FOR_RECYCLING') return 'scrap-confirmations';
  return 'installations';
}

export function LifecycleEventCard({
  currentBattery,
  allAssets,
  onSelectBattery,
  onEventCommitted,
}: {
  currentBattery: BatteryAssetView;
  allAssets: BatteryAssetView[];
  onSelectBattery: (code: string) => void;
  onEventCommitted: (targetCode: string) => Promise<void>;
}) {
  const { actor, loading: identityLoading, switching, roleScoped, switchActor } = useIdentity();
  const [packFilter, setPackFilter] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [eventResource, setEventResource] = useState<string | null>(null);
  const [eventAt, setEventAt] = useState('');
  const [eventBanner, setEventBanner] = useState<CommandResultState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const packList = useMemo(() => {
    const packs = allAssets.filter(a => a.type === 'PACK');
    if (currentBattery.type === 'PACK' && !packs.some(p => p.id === currentBattery.id)) {
      packs.unshift(currentBattery);
    }
    const q = packFilter.trim().toLowerCase();
    const filtered = q
      ? packs.filter(p => `${p.id} ${p.code} ${p.state} ${p.holderMSP}`.toLowerCase().includes(q))
      : packs;
    return [...filtered].sort((a, b) => {
      const aDone = a.state === 'PROCESSED' ? 1 : 0;
      const bDone = b.state === 'PROCESSED' ? 1 : 0;
      return aDone - bDone;
    });
  }, [allAssets, currentBattery, packFilter]);

  // Default target is the currently viewed battery if user hasn't picked another one explicitly
  const targetBattery = useMemo(() => {
    if (selectedAssetId) {
      const found = allAssets.find(a => a.id === selectedAssetId);
      if (found) return found;
    }
    if (currentBattery.type === 'PACK') return currentBattery;
    return packList[0] ?? currentBattery;
  }, [selectedAssetId, allAssets, currentBattery, packList]);

  const selectedEvent = eventResource ?? inferNextEvent(targetBattery);
  const eventMeta = LIFECYCLE_EVENTS.find(e => e.value === selectedEvent) ?? LIFECYCLE_EVENTS[0];

  const waitingForTransfer =
    targetBattery.type === 'PACK' &&
    targetBattery.state === 'RETIRED' &&
    targetBattery.holderMSP !== 'RecycleOrgMSP';

  const roleMatches =
    Boolean(actor) &&
    actor!.role === eventMeta.requiredRole &&
    eventMeta.allowedOrgs.includes(actor!.mspId) &&
    (selectedEvent !== 'retirements' || actor!.mspId === targetBattery.holderMSP);

  const [confirmScrap, setConfirmScrap] = useState(false);
  const [echelonOpen, setEchelonOpen] = useState(false);
  const [echelonModel, setEchelonModel] = useState('ECH-ESS-50KWH');
  const [echelonReportHash, setEchelonReportHash] = useState('');
  const [echelonSubmitting, setEchelonSubmitting] = useState(false);
  const echelonHashValid = /^[a-f0-9]{64}$/.test(echelonReportHash.trim());

  async function computeSha256Hex(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function generateDemoEchelonHash() {
    const payload = new TextEncoder().encode(`echelon:${targetBattery.id}:${targetBattery.code}:${Date.now()}`);
    setEchelonReportHash(await computeSha256Hex(payload.buffer));
  }

  async function handleEchelonFileHash(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEchelonReportHash(await computeSha256Hex(await file.arrayBuffer()));
  }

  const canRegisterEchelon =
    targetBattery.type === 'PACK' &&
    (targetBattery.state === 'RECEIVED_FOR_RECYCLING' || targetBattery.state === 'RETIRED') &&
    !targetBattery.scrappedAt &&
    !targetBattery.echelonCode &&
    targetBattery.holderMSP === 'RecycleOrgMSP' &&
    actor?.mspId === 'RecycleOrgMSP' &&
    actor?.role === 'recycler';

  async function submitEchelonRegistration(e: React.FormEvent) {
    e.preventDefault();
    if (!canRegisterEchelon || echelonSubmitting || !echelonHashValid) return;
    setEchelonSubmitting(true);
    setEventBanner(null);
    try {
      const echelonCode = `${targetBattery.code}T01`;
      const echelonId = `ech-${targetBattery.id}-${Date.now().toString(36).slice(-4)}`;
      const res = await fetch('/api/bff/commands/echelon-assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            id: echelonId,
            originAssetId: targetBattery.id,
            code: echelonCode,
            model: echelonModel.trim() || 'ECH-ESS-50KWH',
            reportHash: echelonReportHash.trim(),
          },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setEventBanner({
          ok: true,
          title: `梯次利用新码 ${echelonCode} 已登记并与原码关联上链`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        setEchelonOpen(false);
        await onEventCommitted(echelonCode);
      } else {
        setEventBanner({
          ok: false,
          title: `梯次利用登记未完成（${json.errorCode ?? json.code ?? 'REJECTED'}）`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          errorCode: json.errorCode ?? json.code,
        });
      }
    } catch {
      setEventBanner({ ok: false, title: '未收到梯次利用登记结果，请刷新档案核对' });
    } finally {
      setEchelonSubmitting(false);
    }
  }

  async function submitLifecycleEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!targetBattery || !actor || identityLoading || switching || submitting || waitingForTransfer || !roleMatches) return;
    if (selectedEvent === 'scrap-confirmations' && !confirmScrap) {
      setConfirmScrap(true);
      return;
    }
    setConfirmScrap(false);
    setSubmitting(true);
    setEventBanner(null);
    try {
      const res = await fetch(`/api/bff/commands/${selectedEvent}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: { assetId: targetBattery.id, at: eventAt.trim() || undefined },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setEventBanner({
          ok: true,
          title: `${targetBattery.id} 生命周期事件已验证上链`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        setEventResource(null);
        setEventAt('');
        await onEventCommitted(targetBattery.code);
      } else {
        const errCode = json.errorCode ?? json.code ?? 'REJECTED';
        setEventBanner({
          ok: false,
          title:
            errCode === 'FORBIDDEN'
              ? `权限拒绝：当前身份 ${actor.name} 无权提交此事件（需 ${eventMeta.requiredRoleHint}）`
              : `生命周期事件未完成（目标：${targetBattery.id}）`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          errorCode: errCode,
        });
      }
    } catch {
      setEventBanner({ ok: false, title: '未收到提交结果，请先刷新档案确认状态' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card-surface card-accent-blue p-5">
      <SectionHeader
        title="受控生命周期事件推进"
        subtitle="可直接选择任意电池包，按证书权限向链码提交装车、首用、退役或报废事件"
        icon={<Wrench className="h-4 w-4 text-brand" />}
      />

      <form onSubmit={e => void submitLifecycleEvent(e)} className="space-y-3 text-xs">
        {/* Battery Selector Dropdown (Optimization 1 from test feedback) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="lifecycle-target-pack" className="font-semibold text-ink-secondary">
              目标电池包（共 {packList.length} 个 PACK 可切换）
            </label>
            {packList.length > 5 && (
              <input
                type="text"
                value={packFilter}
                onChange={e => setPackFilter(e.target.value)}
                placeholder="筛选 ID / 状态..."
                aria-label="筛选可推进生命周期的电池包"
                className="w-32 rounded-md border border-line bg-canvas px-2 py-0.5 text-[11px] outline-none focus:border-brand focus:bg-white"
              />
            )}
          </div>
          <select
            id="lifecycle-target-pack"
            aria-label="选择推进生命周期的电池"
            value={targetBattery.id}
            onChange={e => {
              const nextId = e.target.value;
              setSelectedAssetId(nextId);
              setEventResource(null);
              setEventBanner(null);
              const chosen = allAssets.find(a => a.id === nextId);
              if (chosen && chosen.code !== currentBattery.code) {
                onSelectBattery(chosen.code);
              }
            }}
            disabled={submitting}
            className="mono w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          >
            {packList.length === 0 ? (
              <option value={currentBattery.id}>
                {currentBattery.id}（{currentBattery.type} · 仅 PACK 支持生命周期推进）
              </option>
            ) : (
              packList.map(p => (
                <option key={p.id} value={p.id}>
                  {p.id} · {p.statusLabel || p.state} · 持有: {p.holderMSP.replace('MSP', '')}
                  {p.state === 'PROCESSED' ? ' [终态]' : ''}
                </option>
              ))
            )}
          </select>

          <div className="subtle-surface flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-ink-secondary">当前状态:</span>
              <LifecycleBadge state={targetBattery.state} label={targetBattery.statusLabel} />
              <OrgBadge mspId={targetBattery.holderMSP} />
            </div>
            <span className="mono text-ink-secondary">v{targetBattery.version}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lifecycle-event-select" className="block font-semibold text-ink-secondary">
            推进事件类型
          </label>
          <select
            id="lifecycle-event-select"
            aria-label="生命周期事件"
            value={selectedEvent}
            onChange={e => setEventResource(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          >
            {LIFECYCLE_EVENTS.map(ev => (
              <option key={ev.value} value={ev.value}>
                {ev.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lifecycle-event-time" className="block font-semibold text-ink-secondary">
            事件时间（UTC，留空默认使用服务端当前时间）
          </label>
          <input
            id="lifecycle-event-time"
            type="text"
            aria-label="事件时间（UTC）"
            placeholder="留空使用提交时间，或填写 YYYY-MM-DDTHH:mm:ssZ"
            disabled={submitting}
            value={eventAt}
            onChange={e => setEventAt(e.target.value)}
            className="mono w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
          />
        </div>

        {/* Live Role Pre-Check Feedback */}
        {actor && targetBattery.type === 'PACK' && targetBattery.state !== 'PROCESSED' && !waitingForTransfer && (
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] ${
              roleMatches
                ? 'border-success/30 bg-success/8 text-[#0c5e47]'
                : 'border-warning/35 bg-warning/10 text-[#8a5808]'
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {roleMatches ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  当前身份 <strong className="mono">{actor.name}</strong> 具备此事件提交权限
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
                  该事件要求 <strong className="mono">{eventMeta.requiredRoleHint}</strong>（当前 {actor.name}）
                </>
              )}
            </span>
            {!roleMatches && !roleScoped && (
              <button
                type="button"
                disabled={switching}
                onClick={() => void switchActor(eventMeta.requiredRoleHint)}
                className="mono cursor-pointer rounded-md border border-warning/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink hover:border-brand"
              >
                切换为 {eventMeta.requiredRoleHint}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={
              submitting ||
              identityLoading ||
              !actor ||
              switching ||
              !roleMatches ||
              targetBattery.type !== 'PACK' ||
              targetBattery.state === 'PROCESSED' ||
              waitingForTransfer
            }
            className={`flex-1 cursor-pointer rounded-lg py-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
              confirmScrap && selectedEvent === 'scrap-confirmations'
                ? 'bg-danger hover:bg-red-700'
                : 'bg-navy-900 hover:bg-navy-800'
            }`}
          >
            {submitting
              ? '链码背书提交中...'
              : targetBattery.state === 'PROCESSED'
                ? targetBattery.echelonCode
                  ? '该电池包已合规转入梯次利用（终态锁定）'
                  : '该电池包已处于报废终态（不可推进）'
                : !roleMatches
                  ? `需 ${eventMeta.requiredRoleHint} 身份提交`
                  : confirmScrap && selectedEvent === 'scrap-confirmations'
                    ? '再次点击确认正式报废（终态不可逆）'
                    : `以 ${actor?.name ?? '当前身份'} 提交事件`}
          </button>
          {confirmScrap && selectedEvent === 'scrap-confirmations' && (
            <button
              type="button"
              onClick={() => setConfirmScrap(false)}
              className="cursor-pointer rounded-lg border border-line bg-white px-3 py-2.5 text-xs font-semibold text-ink-secondary hover:bg-subtle"
            >
              取消
            </button>
          )}
        </div>
      </form>

      {canRegisterEchelon && (
        <div className="mt-3 rounded-xl border border-teal/30 bg-teal/[0.05] p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-navy-900">退役电池合规转梯次利用（保留原码关联）</span>
            <button
              type="button"
              onClick={() => setEchelonOpen(v => !v)}
              className="cursor-pointer rounded-lg border border-teal/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-teal hover:bg-teal/10"
            >
              {echelonOpen ? '收起登记' : '登记梯次利用新码'}
            </button>
          </div>
          {echelonOpen && (
            <form onSubmit={submitEchelonRegistration} className="mt-2.5 space-y-2 border-t border-teal/20 pt-2.5">
              <div className="mono text-[11px] text-ink-secondary">
                拟生成梯次编码：<strong className="text-ink">{targetBattery.code}T01</strong>
              </div>
              <input
                type="text"
                value={echelonModel}
                onChange={e => setEchelonModel(e.target.value)}
                placeholder="梯次重组型号（如 ECH-ESS-50KWH）"
                className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink"
              />
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                  <span className="font-semibold text-ink-secondary">梯次检测评估报告 SHA-256</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void generateDemoEchelonHash()}
                      className="cursor-pointer rounded border border-brand/30 bg-brand/8 px-2 py-0.5 font-semibold text-brand hover:bg-brand/15"
                    >
                      生成演示摘要
                    </button>
                    <label className="cursor-pointer rounded border border-line bg-white px-2 py-0.5 font-medium text-ink-secondary hover:border-brand/40 hover:text-ink">
                      文件计算
                      <input type="file" className="sr-only" onChange={e => void handleEchelonFileHash(e)} />
                    </label>
                  </div>
                </div>
                <input
                  type="text"
                  value={echelonReportHash}
                  onChange={e => setEchelonReportHash(e.target.value)}
                  maxLength={64}
                  placeholder="输入或计算 64 位小写 SHA-256 评估报告摘要"
                  className="mono w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11px] text-ink"
                />
              </div>
              <button
                type="submit"
                disabled={echelonSubmitting || !echelonHashValid}
                className="w-full cursor-pointer rounded-lg bg-teal py-2 text-xs font-semibold text-white hover:bg-[#0c8575] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {echelonSubmitting ? '上链中...' : echelonHashValid ? '提交梯次利用新旧码关联' : '请先填写或计算 64 位评估报告摘要'}
              </button>
            </form>
          )}
        </div>
      )}

      {waitingForTransfer && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-brand/6 px-3 py-2.5 text-xs text-ink">
          该电池包已退役且仍由 <strong className="mono">{targetBattery.holderMSP}</strong> 持有，需先移交至回收企业：
          <Link className="ml-1 font-semibold text-brand hover:underline" href="/transfers">
            前往企业交接管理，由回收方确认签收 →
          </Link>
        </div>
      )}

      <div className="mt-3" aria-live="polite">
        <TxResultBanner result={eventBanner} onClose={() => setEventBanner(null)} />
      </div>
    </div>
  );
}
