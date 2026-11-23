'use client';
import { useState } from 'react';
import { Download, FileJson, Upload } from 'lucide-react';

export function MesImport() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 1024 * 1024) throw new Error('文件超过 1 MiB');
      const body = JSON.parse(await file.text());
      const res = await fetch('/api/bff/imports/mes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      setStatus(
        result.completed
          ? `已核验 ${result.result.version} 行 · 交易 ${result.txId}`
          : `未完成 · ${result.errorCode ?? result.code ?? result.stage ?? res.status} · 文件请求号 ${body.requestId ?? '缺失'}`,
      );
    } catch (e) {
      setStatus(
        e instanceof SyntaxError ? '文件不是有效 JSON' : e instanceof Error ? e.message : '导入未确认，请按原文件重试',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-surface space-y-3 p-5 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <FileJson className="h-4 w-4 text-brand" />
            <span>MES 仿真生产与装配导入</span>
          </h2>
          <p className="mt-0.5 text-ink-secondary">
            每个 JSON 文件使用一个机构身份，按行顺序处理，任一行失败则整份文件不写入。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { href: '/examples/mes-production.json', label: '生产示例' },
            { href: '/examples/mes-pack-products.json', label: '模组与包建档' },
            { href: '/examples/mes-supply.json', label: '供货授权' },
            { href: '/examples/mes-assembly.json', label: '装配示例' },
          ].map(ex => (
            <a
              key={ex.href}
              href={ex.href}
              download
              className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-brand transition hover:border-brand/50 hover:bg-blue-50/50"
            >
              <Download className="h-3 w-3" />
              {ex.label}
            </a>
          ))}
        </div>
      </div>

      <div className="subtle-surface flex flex-wrap items-center justify-between gap-3 p-3.5">
        <label className="flex flex-wrap items-center gap-2 font-semibold text-ink">
          <span>生产或装配文件</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={e => {
              setFile(e.target.files?.[0] ?? null);
              setStatus('');
            }}
            className="text-xs font-normal text-ink-secondary file:mr-2.5 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-white file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-ink hover:file:border-brand/50"
          />
        </label>
        <button
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={!file || busy}
          onClick={submit}
        >
          <Upload className="h-3.5 w-3.5" />
          导入 MES 文件
        </button>
      </div>

      {status && (
        <p
          role="status"
          className={`mono rounded-lg border px-3 py-2 text-xs font-medium ${
            status.startsWith('已核验')
              ? 'border-success/35 bg-success/10 text-[#0c5e47]'
              : 'border-warning/35 bg-warning/10 text-[#8a5808]'
          }`}
        >
          {status}
        </p>
      )}
    </section>
  );
}
