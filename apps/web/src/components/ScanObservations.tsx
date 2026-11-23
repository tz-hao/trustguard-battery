'use client';
import { useEffect, useState, useRef } from 'react';
import { MapPin, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/types';
import { scanRequestId } from '@/lib/scan-request-id';

interface Observation {
  site: string;
  observedAt: string;
  previousSite: string | null;
  previousAt: string | null;
}

export function ScanObservations({ code }: { code: string }) {
  const [rows, setRows] = useState<Observation[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/bff/scans?code=${encodeURIComponent(code)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 403 ? '当前角色无权读取站点记录' : '站点记录暂不可用');
        const list = await res.json();
        if (!controller.signal.aborted) setRows(list);
      })
      .catch(e => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, [code, refresh]);

  async function record() {
    setBusy(true);
    try {
      pending.current ||= scanRequestId();
      const res = await fetch('/api/bff/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, requestId: pending.current }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? '当前角色无权登记' : '记录未确认，可重试');
      const row: Observation = await res.json();
      setMessage(row.previousSite ? `异地冲突预警：${row.previousSite} → ${row.site}` : '本站扫码记录已保存');
      pending.current = '';
      setRefresh(n => n + 1);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '站点登记失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-surface space-y-3 p-5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <MapPin className="h-4 w-4 text-teal" />
            <span>标签扫码记录</span>
          </h2>
          <p className="mt-0.5 text-ink-secondary">
            确认在本站见到此标签后登记。演示站点来自当前组织证书，10 分钟内跨站出现同码会提示复核。
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          className="cursor-pointer rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          onClick={record}
        >
          登记本站扫码
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${
            message.includes('冲突')
              ? 'border-danger/35 bg-danger/10 text-danger'
              : 'border-line bg-subtle/80 text-ink'
          }`}
        >
          {message.includes('冲突') && <ShieldAlert className="h-4 w-4 shrink-0" />}
          {message}
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <p
              key={i}
              className={`subtle-surface flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${
                r.previousSite ? 'border-danger/30 bg-danger/5 text-danger' : 'text-ink'
              }`}
            >
              <span className="mono">{formatDateTime(r.observedAt)} · {r.site}</span>
              <span className="font-semibold">
                {r.previousSite ? `异地冲突（${r.previousSite}，${formatDateTime(r.previousAt)}）` : '已登记'}
              </span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
