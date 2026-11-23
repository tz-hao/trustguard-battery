'use client';
import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { QualityBadge } from '@/components/Badges';

interface Subject {
  state: { inspectionVersion: number; quality: string };
  reports: { id: string; version: number; result: string; txId: string; reportHash: string }[];
  retests?: { version: number; proposer: string; proposedTx: string; completedTx?: string }[];
  proposal: { proposedTx: string; proposer: string } | null;
}

export function QualityReview({ assets }: { assets: { id: string; batchId?: string }[] }) {
  const [batchList, setBatchList] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState<Subject | null>(null);
  const [loaded, setLoaded] = useState('');
  const [result, setResult] = useState('QC_REJECTED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/bff/batches', { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (!ctrl.signal.aborted) setBatchList((data.batches ?? []).map((b: { id: string }) => b.id));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!target) return;
    const ctrl = new AbortController();
    fetch(`/api/bff/inspections?subject=${encodeURIComponent(target)}`, { signal: ctrl.signal, cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (!ctrl.signal.aborted) {
          setCurrent(data);
          setLoaded(target);
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          setLoaded('');
          setMessage('无法读取当前报告版本');
        }
      });
    return () => ctrl.abort();
  }, [target, refresh]);

  async function submit(propose: boolean) {
    if (!current || loaded !== target || !note.trim()) return;
    setBusy(true);
    try {
      const version = current.state.inspectionVersion;
      const payload = propose
        ? { data: { subject: target, version }, autoHashes: { reasonHash: note } }
        : { assetId: target, result, note, retest: Boolean(current.proposal), expectedVersion: version };
      const r = await fetch(propose ? '/api/bff/commands/retest-proposals' : '/api/bff/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      const outcome = data.command ?? data;
      setMessage(
        outcome.completed
          ? `已核验交易 ${outcome.txId}`
          : `未完成 · ${outcome.errorCode ?? outcome.code ?? outcome.stage ?? r.status}`,
      );
      setLoaded('');
      setRefresh(n => n + 1);
    } catch {
      setMessage('未收到确认，请刷新核对当前报告');
    } finally {
      setBusy(false);
    }
  }

  const ready = current && loaded === target;

  return (
    <section className="card-surface card-accent-teal space-y-4 p-5 text-xs">
      <div>
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
          <ClipboardCheck className="h-4 w-4 text-teal" />
          <span>整批质检与独立复检</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 font-semibold text-ink-secondary">
          <span>质检对象</span>
          <select
            value={target}
            onChange={e => {
              setTarget(e.target.value);
              setLoaded('');
              setMessage('');
            }}
            className="mono w-full rounded-lg border border-line bg-white px-3 py-2 text-xs font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          >
            <option value="">选择批次或资产</option>
            {batchList.map(id => (
              <option key={'batch:' + id} value={'batch:' + id}>
                批次 {id}
              </option>
            ))}
            {assets.map(a => (
              <option key={a.id} value={a.id}>
                资产 {a.id}
              </option>
            ))}
          </select>
        </label>

        {ready && (
          <label className="block space-y-1 font-semibold text-ink-secondary">
            <span>检测结论</span>
            <select
              value={result}
              onChange={e => setResult(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              <option value="QC_REJECTED">不合格</option>
              <option value="REVIEW_REQUIRED">待复核</option>
              <option value="QC_PASSED">合格</option>
            </select>
          </label>
        )}
      </div>

      {ready && (
        <div className="space-y-3">
          <div className="subtle-surface flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <span className="mono font-bold text-ink">
                当前 v{current.state.inspectionVersion} · {current.state.quality}
              </span>
              <QualityBadge quality={current.state.quality} />
            </div>
            {current.proposal && (
              <p className="mono break-all text-[11px] font-semibold text-[#a86e0c]">
                待独立复检 · 提议交易 {current.proposal.proposedTx}
              </p>
            )}
          </div>

          <label className="block space-y-1 font-semibold text-ink-secondary">
            <span>检测说明或复检理由</span>
            <input
              value={note}
              maxLength={500}
              onChange={e => setNote(e.target.value)}
              placeholder="填写复检理由或质检结论说明..."
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>

          <div className="flex flex-wrap gap-2.5">
            <button
              className="cursor-pointer rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink transition hover:border-brand/50 hover:bg-subtle/60 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={busy || !note.trim() || !current.state.inspectionVersion || !!current.proposal}
              onClick={() => submit(true)}
            >
              提出复检
            </button>
            <button
              className="cursor-pointer rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => submit(false)}
            >
              {current.proposal ? '独立签发复检' : '签发检测报告'}
            </button>
          </div>

          {(current.retests?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              {current.retests?.map(p => (
                <details key={p.proposedTx} className="subtle-surface p-2.5">
                  <summary className="cursor-pointer font-semibold text-ink">复检记录 · 原报告 v{p.version}</summary>
                  <p className="mono mt-1.5 break-all text-[11px] text-ink-secondary">
                    提议身份摘要 {p.proposer} · 提议交易 {p.proposedTx} · 签发交易 {p.completedTx || '待签发'}
                  </p>
                </details>
              ))}
            </div>
          )}

          {current.reports.length > 0 && (
            <div className="space-y-1.5">
              {current.reports.map(r => (
                <details key={r.id} className="subtle-surface p-2.5">
                  <summary className="cursor-pointer font-semibold text-ink">
                    v{r.version} · {r.result}
                  </summary>
                  <p className="mono mt-1.5 break-all text-[11px] text-ink-secondary">
                    交易 {r.txId} · 报告摘要 {r.reportHash}
                  </p>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`mono rounded-lg border px-3 py-2 text-xs font-medium ${
            message.startsWith('已核验')
              ? 'border-success/35 bg-success/10 text-[#0c5e47]'
              : 'border-warning/35 bg-warning/10 text-[#8a5808]'
          }`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
