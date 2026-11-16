'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
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
import { formatDateTime, type BatteryAssetView } from '@/lib/types';

interface TransferRecord {
  id: string;
  packId: string;
  fromMSP: string;
  toMSP: string;
  receiptHash: string;
  state: 'SENT' | 'COMMITTED' | 'CANCELLED' | string;
  assetVersion: number;
  expiresAt: string;
  senderId: string;
  receiverId?: string;
  txId: string;
  blockNumber: string;
  pack: BatteryAssetView | null;
}

export default function TransfersPage() {
  const { actor } = useIdentity();
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [packs, setPacks] = useState<BatteryAssetView[]>([]);
  const [tab, setTab] = useState<'ALL' | 'SENT' | 'COMMITTED' | 'CANCELLED'>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [selectedPackId, setSelectedPackId] = useState('');
  const [toMSP, setToMSP] = useState('RecycleOrgMSP');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<CommandResultState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bff/transfers', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as { transfers: TransferRecord[]; packs: BatteryAssetView[] };
        setTransfers(json.transfers);
        setPacks(json.packs);
        if (!selectedPackId && json.packs.length > 0) setSelectedPackId(json.packs[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedPackId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sha256Client(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function initiateTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPackId) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const trId = `ui-tr-${Date.now().toString(36)}`;
      const receiptHash = await sha256Client(`${trId}:${selectedPackId}:${toMSP}`);
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const res = await fetch('/api/bff/commands/transfers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: { id: trId, packId: selectedPackId, toMSP, receiptHash, expiresAt },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: `交接单 ${trId} 已发起，等待接收方 ${toMSP} 独立签收`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await load();
      } else {
        setBanner({
          ok: false,
          title: `发起交接被链码拦截（当前身份: ${actor?.name ?? '—'}）`,
          requestId: json.requestId,
          stage: json.stage ?? 'rejected',
          errorCode: json.errorCode ?? json.code ?? 'REJECTED',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function actOnTransfer(action: 'transfer-confirmations' | 'transfer-cancellations', tr: TransferRecord) {
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = action === 'transfer-confirmations' ? { id: tr.id, receiptHash: tr.receiptHash } : { id: tr.id };
      const res = await fetch(`/api/bff/commands/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      const json = await res.json();
      if (json.completed) {
        setBanner({
          ok: true,
          title: action === 'transfer-confirmations' ? `交接单 ${tr.id} 双向确认完成，持有权已更新` : `交接单 ${tr.id} 已取消`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await load();
      } else {
        setBanner({
          ok: false,
          title: `交接操作被链码拒绝（当前身份: ${actor?.name ?? '—'}）`,
          requestId: json.requestId,
          stage: json.stage ?? 'rejected',
          errorCode: json.errorCode ?? json.code ?? 'FORBIDDEN',
        });
      }
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
        code="06 · CUSTODY TRANSFER"
        title="跨企业双向交接与退役回收流转管理"
        subtitle="转出方发起 → 目标方独立证书确认 → 链上持有权更新；严格拦截单方伪造确认与已报废电池非法回流"
        right={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#17324f]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新交接单
          </button>
        }
      />

      {/* 双向确认规则说明 */}
      <div className="card-surface p-4">
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-4">
          {[
            { step: '01', title: '转出方发起交接', detail: '校验当前持有方匹配 + 资产版本锁定' },
            { step: '02', title: '目标方独立确认', detail: '仅接收方 toMSP custodian 可执行 ConfirmTransfer' },
            { step: '03', title: '链上持有权变更', detail: '双方一致后状态置为 COMMITTED，更新 holderMSP' },
            { step: '04', title: '报废回流硬拦截', detail: 'PROCESSED 终态电池包禁止普通转移回流' },
          ].map(s => (
            <div key={s.step} className="subtle-surface px-3.5 py-2.5">
              <div className="mono text-[10px] font-bold text-[#2563EB]">RULE {s.step}</div>
              <div className="font-bold text-[#172B3A]">{s.title}</div>
              <div className="text-[11px] text-[#64748B]">{s.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {banner && <TxResultBanner result={banner} onClose={() => setBanner(null)} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="card-surface p-5 lg:col-span-8">
          <SectionHeader
            title="企业交接流水与确认状态"
            subtitle={`当前身份：${actor?.name ?? '—'}（${actor?.mspId ?? ''} · ${actor?.roleLabel ?? ''}）`}
            action={
              <div className="flex gap-1 rounded-lg bg-[#EDF2F7] p-1 text-xs font-semibold">
                {(['ALL', 'SENT', 'COMMITTED', 'CANCELLED'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => {
                      setTab(key);
                      setPage(1);
                    }}
                    className={`rounded-md px-3 py-1 transition ${
                      tab === key ? 'bg-white text-[#10243A] shadow-2xs' : 'text-[#64748B]'
                    }`}
                  >
                    {key === 'ALL' ? `全部 (${transfers.length})` : key === 'SENT' ? '待接收' : key === 'COMMITTED' ? '已完成' : '已取消'}
                  </button>
                ))}
              </div>
            }
          />

          {paged.length === 0 ? (
            <EmptyState title="该状态下暂无交接单" />
          ) : (
            <div className="space-y-4">
              {paged.map(tr => {
                const canConfirm = actor?.mspId === tr.toMSP && actor?.role === 'custodian';
                return (
                  <div key={tr.id} className="subtle-surface p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="mono font-bold text-[#10243A]">{tr.id}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            tr.state === 'COMMITTED'
                              ? 'bg-[#159B76]/15 text-[#159B76]'
                              : tr.state === 'SENT'
                                ? 'bg-[#D99A2B]/15 text-[#b07612]'
                                : 'bg-[#EDF2F7] text-[#64748B]'
                          }`}
                        >
                          {tr.state === 'COMMITTED' && <CheckCircle2 className="h-3 w-3" />}
                          {tr.state === 'CANCELLED' && <XCircle className="h-3 w-3" />}
                          {tr.state === 'SENT' ? '待接收 (SENT)' : tr.state === 'COMMITTED' ? '已完成 (COMMITTED)' : tr.state}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono text-[11px] text-[#64748B]">区块 #{tr.blockNumber}</span>
                        <HashChip value={tr.txId} label="tx" />
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 items-center gap-2 rounded-xl border border-[#dce4ee] bg-white p-3 sm:grid-cols-11">
                      <div className="sm:col-span-4">
                        <div className="text-[10px] text-[#64748B]">转出组织 (FROM)</div>
                        <div className="mt-1 flex items-center gap-2">
                          <OrgBadge mspId={tr.fromMSP} />
                          <span className="font-semibold text-[#159B76]">已签名转出</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-center sm:col-span-3">
                        <ArrowRight className="h-4 w-4 text-[#2563EB]" />
                        <span className="mono text-[10px] text-[#64748B]">资产版本 v{tr.assetVersion}</span>
                      </div>
                      <div className="sm:col-span-4 sm:text-right">
                        <div className="text-[10px] text-[#64748B]">接收组织 (TO)</div>
                        <div className="mt-1 flex items-center gap-2 sm:justify-end">
                          <OrgBadge mspId={tr.toMSP} />
                          <span className={`font-semibold ${tr.state === 'COMMITTED' ? 'text-[#159B76]' : 'text-[#D99A2B]'}`}>
                            {tr.state === 'COMMITTED' ? '已确认接收' : '待签收'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>PACK:</span>
                        <strong className="mono text-[#172B3A]">{tr.packId}</strong>
                        {tr.pack && <LifecycleBadge state={tr.pack.state} label={tr.pack.statusLabel} />}
                        <HashChip value={tr.receiptHash} label="交接凭证" />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="mono text-[10px]">有效期至 {formatDateTime(tr.expiresAt)}</span>
                        {tr.pack && (
                          <Link href={`/identity?code=${encodeURIComponent(tr.pack.code)}`} className="font-semibold text-[#2563EB] hover:underline">
                            查看档案 →
                          </Link>
                        )}
                      </div>
                    </div>

                    {tr.state === 'SENT' && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#dce4ee] pt-3">
                        <button
                          disabled={submitting}
                          onClick={() => void actOnTransfer('transfer-confirmations', tr)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                            canConfirm ? 'bg-[#159B76] hover:bg-emerald-700' : 'bg-[#DC5353] hover:bg-red-700'
                          }`}
                        >
                          以 {actor?.name} 确认接收
                        </button>
                        <button
                          disabled={submitting}
                          onClick={() => void actOnTransfer('transfer-cancellations', tr)}
                          className="rounded-lg border border-[#dce4ee] bg-white px-3 py-1.5 text-xs font-semibold text-[#172B3A] hover:bg-slate-50"
                        >
                          取消交接
                        </button>
                        {!canConfirm && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#DC5353]">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            非 {tr.toMSP} custodian 点击将触发 FORBIDDEN 拦截
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
        <div className="card-surface p-5 lg:col-span-4">
          <SectionHeader
            title="发起企业交接 (InitiateTransfer)"
            subtitle="需当前持有方 custodian 发起；已报废电池包回流会被链码拒绝"
            icon={<ArrowLeftRight className="h-4 w-4 text-[#2563EB]" />}
          />

          <form onSubmit={initiateTransfer} className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-[#64748B]">选择交接电池包</label>
              <select
                value={selectedPackId}
                onChange={e => setSelectedPackId(e.target.value)}
                className="mono w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
              >
                {packs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.state} · 持有: {p.holderMSP}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[#64748B]">目标接收机构</label>
              <select
                value={toMSP}
                onChange={e => setToMSP(e.target.value)}
                className="w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
              >
                <option value="RecycleOrgMSP">RecycleOrgMSP（退役回收企业）</option>
                <option value="PackOrgMSP">PackOrgMSP（PACK 装配企业）</option>
                <option value="CellOrgMSP">CellOrgMSP（电芯制造企业）</option>
                <option value="LabOrgMSP">LabOrgMSP（第三方检测机构）</option>
              </select>
            </div>
            <div className="subtle-surface p-3 text-[11px] text-[#64748B]">
              当前发起身份：<strong className="mono text-[#172B3A]">{actor?.name ?? '—'}</strong>（{actor?.mspId}）
            </div>
            <button
              type="submit"
              disabled={submitting || !selectedPackId}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#10243A] py-2.5 text-xs font-semibold text-white hover:bg-[#17324f] disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? '提交交接中...' : '发起双向交接单'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
