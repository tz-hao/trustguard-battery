'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle2,
  Database,
  FileSearch,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { EmptyState, HashChip, OrgBadge, OverviewLoadNotice, PageBanner, SectionHeader, StagePill } from '@/components/Badges';
import { PaginationBar } from '@/components/Visuals';
import { AuditAnalyticsStrip } from '@/components/DataCharts';
import { ERROR_DESCRIPTIONS, formatDateTime } from '@/lib/types';
import { useOverview } from '@/lib/use-overview';

interface TxRecord {
  requestId: string;
  stage: string;
  txId: string | null;
  blockNumber: string | null;
  errorCode: string | null;
  action: string;
  resourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SecurityLogRecord {
  id: string;
  actorHash: string;
  requestId: string | null;
  action: string;
  outcome: string;
  evidenceHash: string;
  signatureVersion: number;
  auditBatchId: string | null;
  anchoredTxId: string | null;
  createdAt: string;
}

interface AuditBatchRecord {
  id: string;
  signerMSP: string | null;
  blockNumber: string | null;
  stage: string | null;
  firstLogId: string;
  lastLogId: string;
  count: number;
  digest: string;
  txId: string | null;
  createdAt: string;
}

interface LedgerAuditRecord {
  requestId: string;
  resourceId: string;
  action: string;
  actorMSP: string;
  at: string;
  txId: string;
}

interface AuditPayload {
  transactions: TxRecord[];
  securityLogs: SecurityLogRecord[];
  auditBatches: AuditBatchRecord[];
  auditorRoleActive: boolean;
  ledgerAudits: LedgerAuditRecord[];
}

export default function AuditPage() {
  return <Suspense fallback={<p>正在读取审计记录…</p>}><AuditRoute /></Suspense>;
}

function AuditRoute() {
  const batch = useSearchParams().get('batch') ?? '';
  return <AuditView key={batch} batch={batch} />;
}

function AuditView({ batch }: { batch: string }) {
  const { actor, roleScoped, switchActor, switching } = useIdentity();
  const { data, error, loading, load } = useOverview<AuditPayload>('/api/bff/audit' + (batch ? '?batch=' + encodeURIComponent(batch) : ''), switching ? undefined : actor?.name);
  const [tab, setTab] = useState<'tx' | 'logs' | 'batches'>(batch ? 'batches' : 'tx');
  const ledgerAudits = (data?.ledgerAudits ?? []).filter(a => !batch || (a.action === 'AnchorAudit' && a.resourceId === batch));
  const [stageFilter, setStageFilter] = useState<'ALL' | 'VERIFIED' | 'REJECTED'>('ALL');
  const [query, setQuery] = useState('');
  const [txPage, setTxPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const pageSize = 8;

  const [selectedReqId, setSelectedReqId] = useState<string | null>(null);

  const verifiedTxCount = data?.transactions.filter(t => t.stage === 'ledger-verified').length ?? 0;
  const rejectedTxCount = data?.transactions.filter(t => t.stage === 'rejected' || t.stage === 'invalid').length ?? 0;

  const q = query.trim().toLowerCase();
  const filteredTx = (data?.transactions ?? []).filter(t => {
    if (stageFilter === 'VERIFIED' && t.stage !== 'ledger-verified') return false;
    if (stageFilter === 'REJECTED' && t.stage !== 'rejected' && t.stage !== 'invalid') return false;
    if (!q) return true;
    return (
      t.requestId.toLowerCase().includes(q) ||
      t.action.toLowerCase().includes(q) ||
      (t.txId ?? '').toLowerCase().includes(q) ||
      (t.resourceId ?? '').toLowerCase().includes(q) ||
      (t.errorCode ?? '').toLowerCase().includes(q)
    );
  });

  const filteredLogs = (data?.securityLogs ?? []).filter(l => {
    if (!q) return true;
    return (
      l.action.toLowerCase().includes(q) ||
      l.outcome.toLowerCase().includes(q) ||
      (l.requestId ?? '').toLowerCase().includes(q) ||
      l.evidenceHash.toLowerCase().includes(q)
    );
  });

  const txTotalPages = Math.max(1, Math.ceil(filteredTx.length / pageSize));
  const safeTxPage = Math.min(txPage, txTotalPages);
  const pagedTx = filteredTx.slice((safeTxPage - 1) * pageSize, safeTxPage * pageSize);

  const logTotalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const safeLogPage = Math.min(logPage, logTotalPages);
  const pagedLogs = filteredLogs.slice((safeLogPage - 1) * pageSize, safeLogPage * pageSize);

  const selectedTx =
    data?.transactions.find(t => t.requestId === selectedReqId) ?? pagedTx[0] ?? data?.transactions[0] ?? null;
  const linkedLog = selectedTx
    ? data?.securityLogs.find(l => l.requestId === selectedTx.requestId) ?? null
    : null;
  const linkedBatch = linkedLog?.auditBatchId
    ? data?.auditBatches.find(b => b.id === linkedLog.auditBatchId) ?? null
    : null;

  return (
    <div className="space-y-5">
      <PageBanner
        title="区块链审计与交易取证中心"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-[#17324f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1e3e61]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新取证台账
            </button>
          </div>
        }
      />

      <OverviewLoadNotice loading={loading} error={error} hasData={Boolean(data)} onRetry={() => void load()} />
      {data && <>
      {/* 4 Consensus & Forensics KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-xs text-[#64748B]">
            <span>账本核验通过</span>
            <CheckCircle2 className="h-4 w-4 text-[#159B76]" />
          </div>
          <div className="mono mt-1.5 text-2xl font-bold text-[#159B76]">{verifiedTxCount}</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-xs text-[#64748B]">
            <span>拦截拒绝交易</span>
            <XCircle className="h-4 w-4 text-[#DC5353]" />
          </div>
          <div className="mono mt-1.5 text-2xl font-bold text-[#DC5353]">{rejectedTxCount}</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-xs text-[#64748B]">
            <span>安全审计日志</span>
            <ShieldCheck className="h-4 w-4 text-[#2563EB]" />
          </div>
          <div className="mono mt-1.5 text-2xl font-bold text-[#172B3A]">{data?.securityLogs.length ?? 0}</div>
        </div>

        <div className="card-surface p-4">
          <div className="flex items-center justify-between text-xs text-[#64748B]">
            <span>链上审计批次</span>
            <Database className="h-4 w-4 text-[#0F9D8A]" />
          </div>
          <div className="mono mt-1.5 text-2xl font-bold text-[#0F9D8A]">
            {data?.auditorRoleActive ? data.ledgerAudits.length : data?.auditBatches.length ?? 0}
          </div>
        </div>
      </div>

      {/* 锚定率环形图 + 交易动作双色柱状分布 */}
      <AuditAnalyticsStrip
        totalLogs={data.securityLogs.length}
        anchoredLogs={data.securityLogs.filter(l => Boolean(l.anchoredTxId || l.auditBatchId)).length}
        transactions={data.transactions}
      />

      {/* Main Forensics Book */}
      <div className="card-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#dce4ee] pb-3">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'tx', label: `交易存证台账 (${data?.transactions.length ?? 0})` },
              { id: 'logs', label: `Ed25519 安全事件日志 (${data?.securityLogs.length ?? 0})` },
              { id: 'batches', label: `批次摘要锚定 (${data?.auditBatches.length ?? 0})` },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as typeof tab)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  tab === t.id ? 'bg-[#10243A] text-white' : 'bg-[#EDF2F7] text-[#64748B] hover:text-[#172B3A]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tab === 'tx' && (
              <div className="flex items-center gap-1 rounded-lg bg-[#EDF2F7] p-1 text-[11px]">
                {[
                  { id: 'ALL', label: '全部状态' },
                  { id: 'VERIFIED', label: '仅 VALID' },
                  { id: 'REJECTED', label: '仅拒绝' },
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setStageFilter(f.id as typeof stageFilter);
                      setTxPage(1);
                    }}
                    className={`rounded-md px-2.5 py-1 font-medium ${
                      stageFilter === f.id ? 'bg-white text-[#10243A] shadow-xs' : 'text-[#64748B]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-[#94A3B8]" />
              <input
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setTxPage(1);
                  setLogPage(1);
                }}
                placeholder="筛选 requestId / txId / 动作..."
                className="w-56 rounded-lg border border-[#dce4ee] bg-[#F4F7FA] py-1.5 pr-3 pl-8 text-xs text-[#172B3A] outline-none focus:border-[#2563EB] focus:bg-white"
              />
            </div>
          </div>
        </div>

        {/* Tab 1: Transactions Table + Linked Forensic Card */}
        {tab === 'tx' && (
          <div className="space-y-5">
            {pagedTx.length === 0 ? (
              <EmptyState title="暂无匹配的交易台账记录" subtitle="可尝试切换筛选条件或执行业务操作与攻防演练" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#dce4ee] bg-[#F4F7FA] text-[11px] text-[#64748B]">
                        <th className="px-3 py-2.5 font-semibold">业务动作 / 操作</th>
                        <th className="px-3 py-2.5 font-semibold">requestId</th>
                        <th className="px-3 py-2.5 font-semibold">目标资产 / 资源</th>
                        <th className="px-3 py-2.5 font-semibold">Fabric 阶段</th>
                        <th className="px-3 py-2.5 font-semibold">区块高度</th>
                        <th className="px-3 py-2.5 font-semibold">Fabric txId / 错误码</th>
                        <th className="px-3 py-2.5 font-semibold">时间</th>
                        <th className="px-3 py-2.5 text-right font-semibold">取证操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf2f7]">
                      {pagedTx.map(t => {
                        const isSelected = selectedTx?.requestId === t.requestId;
                        return (
                          <tr
                            key={t.requestId}
                            onClick={() => setSelectedReqId(t.requestId)}
                            className={`cursor-pointer transition ${
                              isSelected ? 'bg-[#2563EB]/6' : 'hover:bg-[#F4F7FA]'
                            }`}
                          >
                            <td className="px-3 py-2.5 font-semibold text-[#172B3A]">{t.action}</td>
                            <td className="px-3 py-2.5">
                              <HashChip value={t.requestId} head={10} tail={4} />
                            </td>
                            <td className="mono px-3 py-2.5 text-[#172B3A]">{t.resourceId ?? '—'}</td>
                            <td className="px-3 py-2.5">
                              <StagePill stage={t.stage} />
                            </td>
                            <td className="mono px-3 py-2.5 font-semibold text-[#172B3A]">
                              {t.blockNumber ? `#${t.blockNumber}` : '—'}
                            </td>
                            <td className="px-3 py-2.5">
                              {t.txId ? (
                                <HashChip value={t.txId} head={10} tail={6} />
                              ) : (
                                <span className="mono font-semibold text-[#DC5353]">{t.errorCode ?? '未上链'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-[#64748B]">{formatDateTime(t.updatedAt)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setSelectedReqId(t.requestId);
                                }}
                                className="rounded-md border border-[#dce4ee] bg-white px-2.5 py-1 text-[11px] font-medium text-[#2563EB] hover:border-[#2563EB]"
                              >
                                取证核对
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <PaginationBar page={safeTxPage} totalPages={txTotalPages} totalItems={filteredTx.length} onPageChange={setTxPage} />

                {/* Coupled Forensic Evidence Detail Card (inspired by Mockup 3) */}
                {selectedTx && (
                  <div className="rounded-xl border border-[#1c3554] bg-[#10243A] p-5 text-white">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3a5c] pb-3">
                      <div className="flex items-center gap-2">
                        <FileSearch className="h-4 w-4 text-[#0F9D8A]" />
                        <span className="text-sm font-bold">关联取证档案卡 · 交易与安全日志联合证据</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StagePill stage={selectedTx.stage} />
                        {selectedTx.blockNumber && (
                          <span className="mono rounded bg-[#17324f] px-2 py-0.5 text-[11px] text-sky-200">
                            Block #{selectedTx.blockNumber}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
                      <div className="navy-subcard p-3.5 space-y-2">
                        <div className="text-[11px] font-semibold text-sky-300">1. 交易执行主记录</div>
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-400">requestId</span>
                          <HashChip value={selectedTx.requestId} head={10} tail={6} dark />
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-400">业务动作</span>
                          <span className="mono font-semibold text-white">{selectedTx.action}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-400">目标资源</span>
                          <span className="mono text-slate-200">{selectedTx.resourceId ?? '—'}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-400">txId</span>
                          <HashChip value={selectedTx.txId} head={10} tail={6} dark />
                        </div>
                        {selectedTx.errorCode && (
                          <div className="rounded bg-[#DC5353]/20 px-2 py-1 text-[11px] text-rose-200">
                            拦截错误码：{selectedTx.errorCode}
                            {ERROR_DESCRIPTIONS[selectedTx.errorCode] ? `（${ERROR_DESCRIPTIONS[selectedTx.errorCode]}）` : ''}
                          </div>
                        )}
                      </div>

                      <div className="navy-subcard p-3.5 space-y-2">
                        <div className="text-[11px] font-semibold text-teal-300">2. 关联 Ed25519 安全审计日志</div>
                        {linkedLog ? (
                          <>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">日志 ID</span>
                              <span className="mono text-white">{linkedLog.id}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">执行结果</span>
                              <span className="mono font-semibold text-emerald-300">{linkedLog.outcome}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">签名版本</span>
                              <span className="mono text-slate-200">Ed25519 v{linkedLog.signatureVersion}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">操作者指纹</span>
                              <HashChip value={linkedLog.actorHash} head={8} tail={6} dark />
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">证据摘要</span>
                              <HashChip value={linkedLog.evidenceHash} head={8} tail={6} dark />
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-400">
                            该交易为早期基线或查询记录，暂无同 `requestId` 独立扩展安全日志条目。
                          </div>
                        )}
                      </div>

                      <div className="navy-subcard p-3.5 space-y-2">
                        <div className="text-[11px] font-semibold text-amber-200">3. 链上批次摘要锚定证据</div>
                        {linkedBatch ? (
                          <>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">批次 ID</span>
                              <span className="mono text-white">{linkedBatch.id}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">涵盖日志</span>
                              <span className="mono text-slate-200">
                                #{linkedBatch.firstLogId} ~ #{linkedBatch.lastLogId} ({linkedBatch.count}条)
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">批次根摘要</span>
                              <HashChip value={linkedBatch.digest} head={8} tail={6} dark />
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">锚定 txId</span>
                              <HashChip value={linkedBatch.txId} head={8} tail={6} dark />
                            </div>
                          </>
                        ) : linkedLog?.anchoredTxId ? (
                          <>
                            <div className="text-slate-300">安全日志已直接关联链上锚定交易：</div>
                            <HashChip value={linkedLog.anchoredTxId} head={12} tail={8} dark />
                          </>
                        ) : (
                          <div className="space-y-2 text-slate-400">
                            <p>待审计归档 Worker 聚合后统一写入 Fabric 账本 AuditBatch 锚定记录。</p>
                            <Link
                              href="/identity"
                              className="inline-block text-[11px] text-sky-300 underline hover:text-sky-200"
                            >
                              前往数字身份查验电池链上全历史 →
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 2: Ed25519 Security Logs */}
        {tab === 'logs' && (
          <div>
            {pagedLogs.length === 0 ? (
              <EmptyState title="暂无安全事件日志" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#dce4ee] bg-[#F4F7FA] text-[11px] text-[#64748B]">
                        <th className="px-3 py-2.5 font-semibold">日志 ID</th>
                        <th className="px-3 py-2.5 font-semibold">动作 / 结果</th>
                        <th className="px-3 py-2.5 font-semibold">操作者证书哈希</th>
                        <th className="px-3 py-2.5 font-semibold">证据摘要 SHA-256</th>
                        <th className="px-3 py-2.5 font-semibold">Ed25519 版本</th>
                        <th className="px-3 py-2.5 font-semibold">锚定交易 / 批次</th>
                        <th className="px-3 py-2.5 font-semibold">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf2f7]">
                      {pagedLogs.map(l => (
                        <tr key={l.id} className="hover:bg-[#F4F7FA]">
                          <td className="mono px-3 py-2.5 font-semibold text-[#172B3A]">{l.id}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-[#172B3A]">{l.action}</div>
                            <span
                              className={`mono text-[11px] font-semibold ${
                                l.outcome.includes('REJECT') || l.outcome.includes('BLOCK') || l.outcome.includes('FAIL')
                                  ? 'text-[#DC5353]'
                                  : 'text-[#159B76]'
                              }`}
                            >
                              {l.outcome}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <HashChip value={l.actorHash} />
                          </td>
                          <td className="px-3 py-2.5">
                            <HashChip value={l.evidenceHash} />
                          </td>
                          <td className="mono px-3 py-2.5 text-[#172B3A]">v{l.signatureVersion}</td>
                          <td className="px-3 py-2.5">
                            {l.anchoredTxId ? (
                              <HashChip value={l.anchoredTxId} label="tx" />
                            ) : (
                              <span className="rounded bg-[#D99A2B]/15 px-2 py-0.5 text-[11px] font-medium text-[#b07612]">
                                待批锚定
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-[#64748B]">{formatDateTime(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationBar page={safeLogPage} totalPages={logTotalPages} totalItems={filteredLogs.length} onPageChange={setLogPage} />
              </>
            )}
          </div>
        )}

        {/* Tab 3: Audit Batches & On-Chain Ledger Audits */}
        {tab === 'batches' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="subtle-surface p-4">
              <SectionHeader title="审计锚定批次" subtitle="批次摘要、链上签名组织与交易回执" />
              {!data?.auditBatches.length ? (
                <EmptyState title="暂无已生成的批次记录" />
              ) : (
                <div className="space-y-2.5">
                  {data.auditBatches.map(b => (
                    <div key={b.id} className="rounded-lg border border-[#dce4ee] bg-white p-3 text-xs">
                      <div className="flex items-center justify-between font-semibold">
                        <a className="mono text-[#172B3A] underline" href={'/audit?batch=' + encodeURIComponent(b.id)}>{b.id}</a>
                        <span className="mono text-[#159B76]">{b.count} 条事件</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <HashChip value={b.digest} label="digest" />
                        {batch && b.txId ? <span className="mono break-all">交易 ID {b.txId}</span> : <HashChip value={b.txId} label="txId" />}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {b.signerMSP && <span>签名组织 {b.signerMSP}</span>}
                        {b.blockNumber && <span>区块 #{b.blockNumber}</span>}
                        {b.stage && <span>回执 {b.stage}</span>}
                      </div>
                      <div className="mt-1.5 text-[11px] text-[#64748B]">
                        覆盖日志区间 #{b.firstLogId} ~ #{b.lastLogId} · {formatDateTime(b.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="subtle-surface p-4">
              <SectionHeader
                title="Fabric 链上审计账本（仅 auditor 角色可直查）"
                subtitle="链码 Query('audit') 实时返回的通道防篡改摘要记录"
              />
              {!data?.auditorRoleActive ? (
                <div className="rounded-xl border border-[#D99A2B]/35 bg-[#D99A2B]/10 p-5 text-xs text-[#8f5e0c]">
                  <div className="flex items-center gap-2 font-bold">
                    <Lock className="h-4 w-4" />
                    当前证书角色无权直接读取链上 AuditBatch 账本
                  </div>
                  <p className="mt-1.5 leading-relaxed">
                    当前使用身份 <strong className="mono">{actor?.name}</strong>（{actor?.roleLabel}）。Hyperledger Fabric 链码强制限定仅 `auditor` 角色证书可读取链上批次审计证据。
                  </p>
                  {!roleScoped && (
                    <button
                      type="button"
                      onClick={() => void switchActor('lab-auditor')}
                      className="mt-3 cursor-pointer rounded-lg bg-[#10243A] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#17324f]"
                    >
                      演示模式：切换为 lab-auditor（审计员证书）
                    </button>
                  )}
                </div>
              ) : !ledgerAudits.length ? (
                <EmptyState title="暂无对应的链上审计记录" />
              ) : (
                <div className="space-y-2.5">
                  {ledgerAudits.map(a => (
                    <div key={a.txId} className="rounded-lg border border-[#dce4ee] bg-white p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="mono font-bold text-[#172B3A]">{a.resourceId || a.requestId}</span>
                        <OrgBadge mspId={a.actorMSP} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span>{a.action}</span>
                        <HashChip value={a.txId} label="txId" />
                      </div>
                      <div className="mt-1.5 text-[11px] text-[#64748B]">
                        上链时间 {formatDateTime(a.at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
