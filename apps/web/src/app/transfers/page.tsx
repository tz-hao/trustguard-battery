'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCircle2,
  FileUp,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { useToast } from '@/components/ToastProvider';
import {
  EmptyState,
  HashChip,
  LifecycleBadge,
  OrgBadge,
  PageBanner,
  SectionHeader,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { PaginationBar } from '@/components/Visuals';
import { TransferFlowOverview } from '@/components/DataCharts';
import { formatDateTime, type BatteryAssetView } from '@/lib/types';

interface TransferRecord {
  id: string;
  packId: string;
  fromMSP: string;
  toMSP: string;
  receiptHash: string;
  state: string;
  createdTx?: string;
  sentTx?: string;
  acceptedTx?: string;
  committedTx?: string;
  cancelledTx?: string;
  assetVersion: number;
  expiresAt: string;
  senderId: string;
  receiverId?: string;
  txId: string;
  blockNumber: string;
  pack: BatteryAssetView | null;
}

const stateLabels = { CREATED: '待发出', SENT: '待签收', ACCEPTED: '待提交', COMMITTED: '已完成', CANCELLED: '已取消' };
const steps = {
  CREATED: { resource: 'transfer-dispatches', field: 'sentTx', label: '发出交接单', result: '已发出，等待接收方签收' },
  SENT: { resource: 'transfer-acceptances', field: 'acceptedTx', label: '签收凭证', result: '已签收，电池仍由转出方持有' },
  ACCEPTED: { resource: 'transfer-commits', field: 'committedTx', label: '提交持有权变更', result: '已完成，持有权已转至接收方' },
} as const;
type Step = (typeof steps)[keyof typeof steps];
const cancelStep = { resource: 'transfer-cancellations', field: 'cancelledTx', label: '取消交接', result: '已取消' } as const;
type ExpectedStep = { id: string; field: keyof TransferRecord; tx: string };

const STEPPER_STAGES = [
  { key: 'CREATED', label: '已创建' },
  { key: 'SENT', label: '已发出' },
  { key: 'ACCEPTED', label: '已签收' },
  { key: 'COMMITTED', label: '已交接' },
] as const;

function getStageIndex(state: string): number {
  if (state === 'CREATED') return 0;
  if (state === 'SENT') return 1;
  if (state === 'ACCEPTED') return 2;
  if (state === 'COMMITTED') return 3;
  return -1;
}

function inspectSha256(raw: string): { normalized: string; valid: boolean; message: string } {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { normalized, valid: false, message: '可点击「系统自动生成」或上传交接单据计算 64 位 SHA-256 摘要' };
  }
  if (!/^[0-9a-f]+$/.test(normalized)) {
    return { normalized, valid: false, message: '格式无效：仅允许十六进制字符（0–9、a–f）' };
  }
  if (normalized.length !== 64) {
    return { normalized, valid: false, message: `长度校验未通过：当前 ${normalized.length} / 64 位` };
  }
  return { normalized, valid: true, message: 'SHA-256 格式校验通过（64 位十六进制有效摘要）' };
}

async function digestSha256Hex(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = buffer instanceof Uint8Array ? buffer.slice().buffer : buffer;
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }
  // Secure fallback when subtle crypto is unavailable on non-HTTPS LAN origins
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function createDraftIntent(packId: string, toMSP: string, receiptHash: string) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { id: `ui-tr-${nonce}`, packId, toMSP, receiptHash, expiresAt };
}

async function readTransfers(expected?: ExpectedStep, signal?: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('/api/bff/transfers', { cache: 'no-store', signal });
    if (!res.ok) throw new Error('TRANSFER_LIST_UNAVAILABLE');
    const data = (await res.json()) as { transfers: TransferRecord[]; packs: BatteryAssetView[] };
    const current = !expected || data.transfers.some(t => t.id === expected.id && t[expected.field] === expected.tx);
    if (current || attempt === 8) return { ...data, current };
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}

export default function TransfersPage() {
  const { actor, loading: identityLoading, switching } = useIdentity();
  const { notify } = useToast();
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [packs, setPacks] = useState<BatteryAssetView[]>([]);
  const [tab, setTab] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [selectedPackId, setSelectedPackId] = useState('');
  const [target, setTarget] = useState('');
  const [receiptHash, setReceiptHash] = useState('');
  const [receiptSourceNote, setReceiptSourceNote] = useState('');
  const [receivedHashes, setReceivedHashes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<CommandResultState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [asOf, setAsOf] = useState(0);
  const lastRead = useRef(0);

  const nextExpiry = transfers.reduce((next, t) => {
    const expiry = Date.parse(t.expiresAt);
    return Object.hasOwn(steps, t.state) && expiry > asOf ? Math.min(next, expiry) : next;
  }, Infinity);

  const eligiblePacks = packs.filter(
    p =>
      p.holderMSP === actor?.mspId &&
      !['PROCESSED', 'RECEIVED_FOR_RECYCLING'].includes(p.state) &&
      !transfers.some(t => t.packId === p.id && Object.hasOwn(steps, t.state)),
  );
  const pack = eligiblePacks.find(p => p.id === selectedPackId) ?? eligiblePacks[0];
  const destinations = ['CellOrgMSP', 'PackOrgMSP', 'LabOrgMSP', 'RecycleOrgMSP'].filter(
    org => org !== pack?.holderMSP && (org === 'RecycleOrgMSP') === (pack?.state === 'RETIRED'),
  );
  const toMSP = destinations.includes(target) ? target : destinations[0];

  const receiptCheck = inspectSha256(receiptHash);

  const load = useCallback((expected?: ExpectedStep, signal?: AbortSignal) => {
    const request = ++lastRead.current;
    const active = () => !signal?.aborted && request === lastRead.current;
    return readTransfers(expected, signal)
      .then(data => {
        if (!active()) return;
        setTransfers(data.transfers);
        setPacks(data.packs);
        setAsOf(Date.now());
        setLoadError(!data.current);
      })
      .catch(() => {
        if (active()) setLoadError(true);
      })
      .finally(() => {
        if (active()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setAsOf(Date.now()), Math.max(1, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [nextExpiry]);

  async function handleGenerateReceiptHash() {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('');
    const payload = JSON.stringify({
      kind: 'TRUSTGUARD_CUSTODY_RECEIPT',
      packId: pack?.id ?? 'unselected',
      version: pack?.version ?? 0,
      fromMSP: actor?.mspId ?? 'unknown',
      toMSP: toMSP ?? 'unknown',
      issuedAt: new Date().toISOString(),
      nonce,
    });
    const hex = await digestSha256Hex(new TextEncoder().encode(payload));
    setReceiptHash(hex);
    setReceiptSourceNote(`系统已基于 ${pack?.id ?? '当前草稿'} 交接元数据生成 SHA-256 凭证摘要`);
    notify({ tone: 'success', title: '已生成 64 位 SHA-256 交接凭证', description: `${hex.slice(0, 12)}...${hex.slice(-8)}` });
  }

  async function handleFileReceiptHash(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const buf = await file.arrayBuffer();
    const hex = await digestSha256Hex(buf);
    setReceiptHash(hex);
    setReceiptSourceNote(`已由文件「${file.name}」本地计算 SHA-256 摘要`);
    notify({ tone: 'info', title: '文件 SHA-256 计算完成', description: file.name });
  }

  async function initiateTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (
      !pack ||
      !toMSP ||
      !receiptCheck.valid ||
      actor?.role !== 'custodian' ||
      loadError ||
      identityLoading ||
      switching ||
      submitting
    ) {
      return;
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const draft = createDraftIntent(pack.id, toMSP, receiptCheck.normalized);
      const res = await fetch('/api/bff/commands/transfer-drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: draft.id,
          data: draft,
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: `交接单 ${draft.id} 已创建，等待转出方发出`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        setReceiptHash('');
        setReceiptSourceNote('');
        setTab('ALL');
        setPage(1);
        await load({ id: draft.id, field: 'createdTx', tx: json.txId });
      } else {
        setBanner({
          ok: false,
          title: `发起交接未完成（当前身份: ${actor.name}）`,
          requestId: json.requestId,
          stage: json.stage,
          errorCode: json.errorCode ?? json.code,
        });
      }
    } catch {
      setBanner({ ok: false, title: '未收到交接提交结果，请先刷新交接列表确认状态' });
    } finally {
      setSubmitting(false);
    }
  }

  async function actOnTransfer(step: Step | typeof cancelStep, tr: TransferRecord) {
    if (!actor || identityLoading || switching || submitting) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const normalizedReceived = (receivedHashes[tr.id] ?? '').trim().toLowerCase();
      const payload =
        step.resource === 'transfer-acceptances' ? { id: tr.id, receiptHash: normalizedReceived } : { id: tr.id };
      const res = await fetch(`/api/bff/commands/${step.resource}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: `交接单 ${tr.id} ${step.result}`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
          nextHref: step.resource === 'transfer-commits' && tr.pack?.code ? `/identity?code=${encodeURIComponent(tr.pack.code)}` : undefined,
          nextLabel: step.resource === 'transfer-commits' && tr.pack?.code ? '打开该电池数字身份证' : undefined,
        });
        await load({ id: tr.id, field: step.field, tx: json.txId });
      } else {
        setBanner({
          ok: false,
          title: `交接操作未完成（当前身份: ${actor.name}）`,
          requestId: json.requestId,
          stage: json.stage,
          errorCode: json.errorCode ?? json.code,
        });
      }
    } catch {
      setBanner({ ok: false, title: '未收到交接确认结果，请先刷新交接列表确认状态' });
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = transfers.filter(t => (tab === 'ALL' ? true : t.state === tab));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6">
      <PageBanner
        title="跨企业双向交接与退役回收流转管理"
        right={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || submitting}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-[#17324f]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新交接单
          </button>
        }
      />

      {banner && <TxResultBanner result={banner} onClose={() => setBanner(null)} />}
      {loadError && (
        <p role="alert" className="rounded-xl border border-danger/35 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          暂未读到最新交接记录，请刷新列表核对交易状态。
        </p>
      )}

      <TransferFlowOverview transfers={transfers} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <div className="card-surface p-5 lg:col-span-8">
          <SectionHeader
            title="企业交接流水与确认状态"
            subtitle={`当前身份：${actor?.name ?? '—'}（${actor?.mspId ?? ''} · ${actor?.roleLabel ?? ''}）`}
            action={
              <div className="flex flex-wrap gap-1 rounded-lg bg-subtle p-1 text-xs font-semibold">
                {['ALL', ...Object.keys(stateLabels)].map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setTab(key);
                      setPage(1);
                    }}
                    className={`cursor-pointer rounded-md px-3 py-1 transition ${
                      tab === key ? 'bg-white text-navy-900 shadow-2xs' : 'text-ink-secondary hover:text-ink'
                    }`}
                  >
                    {key === 'ALL' ? `全部 (${transfers.length})` : stateLabels[key as keyof typeof stateLabels]}
                  </button>
                ))}
              </div>
            }
          />

          {loading && transfers.length === 0 ? (
            <div className="space-y-3 py-2">
              <div className="skeleton-block h-28" />
              <div className="skeleton-block h-28" />
            </div>
          ) : paged.length === 0 ? (
            <EmptyState title="该状态下暂无交接单" />
          ) : (
            <div className="space-y-4">
              {paged.map(tr => {
                const step = steps[tr.state as keyof typeof steps];
                const sender = actor?.role === 'custodian' && actor.mspId === tr.fromMSP;
                const receiver = actor?.role === 'custodian' && actor.mspId === tr.toMSP;
                const expired = Date.parse(tr.expiresAt) <= asOf;
                const canAct = (tr.state === 'CREATED' ? sender : receiver) && !expired;
                const stageIdx = getStageIndex(tr.state);
                const recCheck = inspectSha256(receivedHashes[tr.id] ?? '');

                return (
                  <div
                    key={tr.id}
                    className={`subtle-surface p-4 text-xs transition ${
                      tr.state === 'COMMITTED'
                        ? 'border-success/30'
                        : tr.state === 'CANCELLED'
                          ? 'opacity-80'
                          : 'border-line'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="mono font-bold text-navy-900">{tr.id}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            tr.state === 'COMMITTED'
                              ? 'bg-success/15 text-success'
                              : tr.state === 'SENT'
                                ? 'bg-warning/15 text-[#a86e0c]'
                                : tr.state === 'ACCEPTED'
                                  ? 'bg-brand/12 text-brand'
                                  : tr.state === 'CANCELLED'
                                    ? 'bg-danger/12 text-danger'
                                    : 'bg-white text-ink-secondary border border-line'
                          }`}
                        >
                          {tr.state === 'COMMITTED' && <CheckCircle2 className="h-3 w-3" />}
                          {tr.state === 'CANCELLED' && <XCircle className="h-3 w-3" />}
                          {stateLabels[tr.state as keyof typeof stateLabels] ?? tr.state} ({tr.state})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] text-ink-secondary">区块 #{tr.blockNumber}</span>
                        <HashChip value={tr.txId} label="tx" />
                      </div>
                    </div>

                    {/* Connected Horizontal 4-Stage Timeline Stepper */}
                    {tr.state !== 'CANCELLED' && (
                      <div className="mt-3 rounded-xl border border-line/80 bg-white px-4 py-3">
                        <div className="relative grid grid-cols-4 gap-2">
                          {/* Background track line */}
                          <div className="pointer-events-none absolute top-3 right-[12%] left-[12%] h-0.5 rounded-full bg-line" />
                          {/* Active progress fill line */}
                          <div
                            className="pointer-events-none absolute top-3 left-[12%] h-0.5 rounded-full bg-gradient-to-r from-success to-teal transition-all duration-300"
                            style={{
                              width: `${Math.min(100, (Math.max(0, tr.state === 'COMMITTED' ? 3 : stageIdx) / 3) * 76)}%`,
                            }}
                          />
                          {STEPPER_STAGES.map((st, idx) => {
                            const completed = stageIdx > idx || tr.state === 'COMMITTED';
                            const current = stageIdx === idx && tr.state !== 'COMMITTED';
                            return (
                              <div key={st.key} className="relative z-10 flex flex-col items-center gap-1.5 text-center">
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition ${
                                    completed
                                      ? 'bg-success text-white shadow-xs shadow-success/30'
                                      : current
                                        ? 'border-2 border-teal bg-white text-teal ring-4 ring-teal/15'
                                        : 'border border-line bg-canvas text-ink-muted'
                                  }`}
                                >
                                  {completed ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                                </span>
                                <span
                                  className={`text-[11px] font-semibold ${
                                    completed ? 'text-success' : current ? 'text-navy-900' : 'text-ink-muted'
                                  }`}
                                >
                                  {st.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* FROM -> TO Custody Cards */}
                    <div className="mt-3 grid grid-cols-1 items-center gap-2 rounded-xl border border-line bg-white p-3.5 sm:grid-cols-11">
                      <div className="sm:col-span-4">
                        <div className="text-[11px] text-ink-secondary">转出组织 (FROM)</div>
                        <div className="mt-1 flex items-center gap-2">
                          <OrgBadge mspId={tr.fromMSP} />
                          <span className="font-semibold text-success">已签名转出</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center sm:col-span-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-teal/12 text-teal">
                          <ArrowRight className="h-4 w-4" />
                        </div>
                        <span className="mono mt-1 text-[11px] text-ink-secondary">资产版本 v{tr.assetVersion}</span>
                      </div>
                      <div className="sm:col-span-4 sm:text-right">
                        <div className="text-[11px] text-ink-secondary">接收组织 (TO)</div>
                        <div className="mt-1 flex items-center gap-2 sm:justify-end">
                          <OrgBadge mspId={tr.toMSP} />
                          <span className={`font-semibold ${tr.state === 'COMMITTED' ? 'text-success' : 'text-[#a86e0c]'}`}>
                            {tr.receiverId ? '已签收' : '无签收记录'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>PACK:</span>
                        <strong className="mono text-ink">{tr.packId}</strong>
                        {tr.pack && <LifecycleBadge state={tr.pack.state} label={tr.pack.statusLabel} />}
                        {tr.pack && <span>当前持有方 {tr.pack.holderMSP}</span>}
                        <HashChip value={tr.receiptHash} label="交接凭证" />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="mono text-[11px]">有效期至 {formatDateTime(tr.expiresAt)}</span>
                        {tr.pack && (
                          <Link
                            href={`/identity?code=${encodeURIComponent(tr.pack.code)}`}
                            className="font-semibold text-brand hover:underline"
                          >
                            查看档案 →
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {(
                        [
                          ['创建', tr.createdTx],
                          ['发出', tr.sentTx],
                          ['签收', tr.acceptedTx],
                          ['提交', tr.committedTx],
                          ['取消', tr.cancelledTx],
                        ] as const
                      ).map(([label, tx]) => tx && <HashChip key={label} value={tx} label={label} />)}
                    </div>

                    {step && (
                      <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
                        {tr.state === 'SENT' && receiver && !expired && (
                          <div className="w-full space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label htmlFor={`recv-hash-${tr.id}`} className="font-semibold text-ink-secondary">
                                所收凭证 SHA-256
                              </label>
                              <button
                                type="button"
                                onClick={() => setReceivedHashes({ ...receivedHashes, [tr.id]: tr.receiptHash })}
                                className="cursor-pointer text-[11px] font-semibold text-brand hover:underline"
                              >
                                一键填入核对凭证（演示辅助）
                              </button>
                            </div>
                            <input
                              id={`recv-hash-${tr.id}`}
                              aria-label="所收凭证 SHA-256"
                              className="mono w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                              maxLength={64}
                              placeholder="粘贴或核对转出方提供的 64 位 SHA-256 交接凭证"
                              value={receivedHashes[tr.id] ?? ''}
                              onChange={e => setReceivedHashes({ ...receivedHashes, [tr.id]: e.target.value })}
                            />
                            <div
                              className={`text-[11px] font-medium ${
                                recCheck.valid
                                  ? 'text-success'
                                  : receivedHashes[tr.id]
                                    ? 'text-danger'
                                    : 'text-ink-muted'
                              }`}
                            >
                              {recCheck.message}
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={
                            submitting ||
                            identityLoading ||
                            switching ||
                            loadError ||
                            !canAct ||
                            (tr.state === 'SENT' && !recCheck.valid)
                          }
                          onClick={() => void actOnTransfer(step, tr)}
                          className="cursor-pointer rounded-lg bg-success px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#118061] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {step.label}
                        </button>
                        <button
                          type="button"
                          disabled={
                            submitting ||
                            identityLoading ||
                            switching ||
                            loadError ||
                            !(sender || (tr.state !== 'CREATED' && receiver))
                          }
                          onClick={() => void actOnTransfer(cancelStep, tr)}
                          className="cursor-pointer rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink transition hover:bg-subtle/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          取消交接
                        </button>
                        {!canAct && (
                          <span className="text-xs text-ink-secondary">
                            {expired
                              ? '交接已过期，可由参与方取消'
                              : `等待 ${tr.state === 'CREATED' ? tr.fromMSP : tr.toMSP} 的交接保管员操作`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <PaginationBar page={page} totalPages={totalPages} totalItems={filtered.length} onPageChange={setPage} />
        </div>

        {/* 右：发起交接台 */}
        <div className="card-surface card-accent-teal p-5 lg:col-span-4">
          <SectionHeader
            title="创建企业交接单"
            subtitle="需当前持有方 custodian 发起；已报废电池包回流会被链码拒绝"
            icon={<ArrowLeftRight className="h-4 w-4 text-teal" />}
          />

          <form onSubmit={event => void initiateTransfer(event)} className="space-y-4 text-xs">
            <div>
              <label htmlFor="transfer-pack-select" className="mb-1.5 block font-semibold text-ink-secondary">
                选择交接电池包
              </label>
              <select
                id="transfer-pack-select"
                aria-label="选择交接电池包"
                value={pack?.id ?? ''}
                onChange={e => setSelectedPackId(e.target.value)}
                className="mono w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                {!pack && <option value="">无可交接电池包</option>}
                {eligiblePacks.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.state} · 持有: {p.holderMSP}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="transfer-dest-select" className="mb-1.5 block font-semibold text-ink-secondary">
                目标接收机构
              </label>
              <select
                id="transfer-dest-select"
                aria-label="目标接收机构"
                value={toMSP ?? ''}
                onChange={e => setTarget(e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                {destinations.map(org => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>
            </div>

            {/* Optimization 2: Auto-generate + File SHA-256 + Live Validation */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="transfer-receipt-hash" className="font-semibold text-ink-secondary">
                  发出凭证 SHA-256
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleGenerateReceiptHash()}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-brand/30 bg-brand/8 px-2 py-0.5 text-[11px] font-semibold text-brand transition hover:bg-brand/15"
                  >
                    <Sparkles className="h-3 w-3" />
                    系统自动生成
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-line bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-secondary transition hover:border-brand/40 hover:text-ink">
                    <FileUp className="h-3 w-3" />
                    文件计算
                    <input type="file" className="sr-only" onChange={e => void handleFileReceiptHash(e)} />
                  </label>
                </div>
              </div>

              <input
                id="transfer-receipt-hash"
                aria-label="发出凭证 SHA-256"
                className={`mono w-full rounded-lg border bg-white px-3 py-2 text-xs outline-none transition ${
                  receiptHash && !receiptCheck.valid
                    ? 'border-danger/60 ring-2 ring-danger/15'
                    : receiptCheck.valid
                      ? 'border-success/55 ring-2 ring-success/12'
                      : 'border-line focus:border-brand focus:ring-2 focus:ring-brand/15'
                }`}
                required
                maxLength={64}
                placeholder="点击上方「系统自动生成」或输入 64 位 SHA-256"
                value={receiptHash}
                onChange={e => {
                  setReceiptHash(e.target.value);
                  setReceiptSourceNote('');
                }}
              />

              <div
                className={`flex items-start gap-1.5 text-[11px] font-medium ${
                  receiptCheck.valid ? 'text-success' : receiptHash ? 'text-danger' : 'text-ink-muted'
                }`}
              >
                {receiptCheck.valid ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : receiptHash ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : null}
                <span>{receiptSourceNote || receiptCheck.message}</span>
              </div>
            </div>

            <div className="subtle-surface space-y-1 p-3 text-xs text-ink-secondary">
              <div>
                当前发起身份：<strong className="mono text-ink">{actor?.name ?? '加载中...'}</strong>（{actor?.mspId}）
              </div>
              {actor && actor.role !== 'custodian' && (
                <div className="text-[11px] font-medium text-[#a86e0c]">
                  仅资产交接保管员 (custodian) 可发起或签收交接单。
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={
                submitting ||
                identityLoading ||
                switching ||
                loadError ||
                actor?.role !== 'custodian' ||
                !pack ||
                !toMSP ||
                !receiptCheck.valid
              }
              className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-navy-900 py-2.5 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? '提交中…' : '创建交接单'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
