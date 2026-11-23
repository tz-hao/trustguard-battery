'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';

type Claim = { text: string; evidenceIds: string[] };
type Evidence = { id: string; kind: string; facts: Record<string, unknown> };
type Answer = {
  assetId: string;
  requestId: string;
  state: string;
  errorCode?: string;
  stale?: boolean;
  result?: {
    model: string;
    generatedAt: string;
    evidence: Evidence[];
    references: { evidenceId: string; kind: string; resourceId: string; txId?: string }[];
    analysis: { summary: Claim; findings: Claim[]; reviewSuggestions: Claim[]; unknowns: string[] };
  };
};
const errors: Record<string, string> = {
  AI_DISABLED: '服务器尚未启用 DeepSeek。',
  AI_NOT_CONFIGURED: '服务器尚未配置模型凭据。',
  AI_CONFIGURATION_INVALID: '服务器模型配置需要管理员检查。',
  FORBIDDEN: '当前身份无权分析这块电池。请使用持有组织的业务身份或检测机构的检测、审计身份。',
  AI_BUDGET_EXHAUSTED: '全站今日模型额度已用完，北京时间零点恢复。仍可读取已有分析。',
  AI_RATE_LIMITED: '请求较多，请稍后再试。',
  AI_PROVIDER_AUTH_FAILED: '模型服务未接受服务器凭据。',
  AI_PROVIDER_BALANCE_REQUIRED: '模型账户余额不足。',
  AI_PROVIDER_RATE_LIMITED: '模型服务当前限流。',
  AI_EVIDENCE_CHANGED: '档案证据已变化，请刷新后重新核对。',
  AI_TIMEOUT: '模型响应超时。',
  AI_UNKNOWN_EVIDENCE: '模型回答引用了不存在的记录，已拒绝展示。',
  AI_INVALID_OUTPUT: '模型回答未通过结构校验。',
  AI_REAL_DATA_DISABLED: '当前仅支持模拟电池。',
  AI_TRANSPORT_UNCONFIRMED: '请求结果暂未确认。请先读取已保存结果。',
  AI_INTERRUPTED_NO_AUTOMATIC_RETRY: '上次分析中断。',
  NOT_FOUND: '尚未查到这次请求的记录。',
};
const explain = (code?: string) => errors[code ?? ''] ?? '分析暂不可用' + (code ? '（' + code + '）' : '，请稍后重试。');
const kinds: Record<string, string> = {
  asset: '链上资产快照',
  inspection: '链上质检记录',
  risk: '已保存的风险凭证',
  missing: '缺少评估记录',
  scope: '本次分析范围',
};
const fields: Record<string, string> = {
  target: '查询对象',
  type: '资产类型',
  chemistry: '化学体系',
  state: '生命周期状态',
  quality: '质量状态',
  version: '版本',
  inspectionVersion: '质检版本',
  manufacturedAt: '生产日期',
  at: '记录时间',
  result: '检测结论',
  level: '风险等级',
  issuedAt: '签发时间',
  expiresAt: '有效期至',
  modelVersion: '模型版本',
  policyVersion: '策略版本',
};

function AnalysisResult({ answer }: { answer: Answer }) {
  const result = answer.result;
  if (!result) {
    return (
      <p role="status" className="subtle-surface px-3 py-2 text-xs text-ink-secondary">
        {answer.state === 'running' ? '分析处理中，可稍后读取结果。' : explain(answer.errorCode)}
      </p>
    );
  }
  const a = result.analysis;
  function claim(item: Claim, i: number) {
    return (
      <li key={i} className="my-1.5 leading-relaxed text-ink">
        {item.text}{' '}
        {item.evidenceIds.map(id => (
          <button
            key={id}
            type="button"
            className="mr-1 cursor-pointer rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand transition hover:bg-brand/20"
            onClick={() => {
              const detail = document.getElementById('ai-proof-' + id);
              if (detail instanceof HTMLDetailsElement) {
                detail.open = true;
                detail.scrollIntoView({ block: 'nearest' });
                detail.querySelector('summary')?.focus({ preventScroll: true });
              }
            }}
          >
            依据 {id}
          </button>
        ))}
      </li>
    );
  }
  return (
    <article className="space-y-3 rounded-xl border border-brand/20 bg-brand/[0.03] p-4 text-xs" aria-label="模型分析结果">
      <p className="mono text-[11px] text-ink-secondary">
        {result.model} · {new Date(result.generatedAt).toLocaleString('zh-CN')} · 供人工复核
      </p>
      {answer.stale && (
        <p role="status" className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-1.5 text-xs text-[#8a5808]">
          生成后资产或策略已更新，请按历史分析阅读。
        </p>
      )}
      <ul className="list-disc pl-5">{[a.summary, ...a.findings].map(claim)}</ul>
      {a.reviewSuggestions.length > 0 && (
        <>
          <h3 className="font-bold text-ink">复核建议</h3>
          <ul className="list-disc pl-5">{a.reviewSuggestions.map(claim)}</ul>
        </>
      )}
      {a.unknowns.length > 0 && <p className="text-ink-secondary">尚待核实 · {a.unknowns.join('；')}</p>}
      <h3 className="font-bold text-ink">引用记录</h3>
      <div className="space-y-1.5">
        {result.references.map(ref => {
          const facts = result.evidence.find(e => e.id === ref.evidenceId)?.facts ?? {};
          const review = facts.review as
            | { missingMeasurements: number; qualityRules: string[]; operationRules: string[] }
            | null
            | undefined;
          return (
            <details
              key={ref.evidenceId}
              id={'ai-proof-' + ref.evidenceId}
              className="subtle-surface break-all p-2.5 open:border-brand/40 open:bg-white"
            >
              <summary className="cursor-pointer font-semibold text-ink">
                {ref.evidenceId} · {kinds[ref.kind] ?? ref.kind} · {ref.resourceId}
              </summary>
              <div className="mt-1.5 space-y-1 border-t border-line/70 pt-1.5 text-[11px] text-ink-secondary">
                {ref.txId && <p className="mono">Fabric 交易 · {ref.txId}</p>}
                {Object.entries(fields)
                  .filter(([key]) => facts[key] != null)
                  .map(([key, label]) => (
                    <p key={key}>
                      {label} · <span className="mono text-ink">{String(facts[key])}</span>
                    </p>
                  ))}
                {ref.kind === 'risk' && facts.stale === true && (
                  <p>生成分析时该凭证已过期或对应较早的资产、策略版本。</p>
                )}
                {review && (
                  <p>
                    缺测 {review.missingMeasurements} 项 · 质量规则 {review.qualityRules.join('、') || '无'} · 操作规则{' '}
                    {review.operationRules.join('、') || '无'}
                  </p>
                )}
                {ref.kind === 'missing' && <p>此次取证时没有该资产的风险评估记录。</p>}
                {ref.kind === 'scope' && <p>仅覆盖所查资产与当前 PACK 组件。</p>}
              </div>
            </details>
          );
        })}
      </div>
    </article>
  );
}

export function BatteryAdvisor({ assetId }: { assetId: string }) {
  const [question, setQuestion] = useState('哪些记录支持这块电池的风险判断？');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [blocked, setBlocked] = useState('正在检查分析权限…');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const pending = useRef<{ signature: string; id: string } | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      return Promise.all([
        fetch('/api/bff/ai', { cache: 'no-store', signal }),
        fetch('/api/bff/ai?assetId=' + encodeURIComponent(assetId), { cache: 'no-store', signal }),
      ])
        .then(async ([s, h]) => {
          const [status, history] = await Promise.all([s.json(), h.json()]);
          if (signal?.aborted) return;
          setBlocked(
            !h.ok
              ? explain(history.code)
              : !s.ok || !status.available
                ? explain(status.reason ?? status.code)
                : '',
          );
          setAnswer(h.ok && history.latest?.assetId === assetId ? history.latest : null);
          setMessage(h.ok && !history.latest ? '当前身份在此档案还没有保存的分析。' : '');
        })
        .catch(() => {
          if (!signal?.aborted) setBlocked('暂时无法读取模型状态，请重新读取。');
        });
    },
    [assetId],
  );

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  async function submit(task: 'risk_explanation' | 'trace_question') {
    if (running.current || blocked) return;
    const text = task === 'trace_question' ? question.trim() : undefined;
    const signature = JSON.stringify([task, text]);
    if (!pending.current || pending.current.signature !== signature) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      pending.current = {
        signature,
        id: 'web-ai-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
      };
    }
    running.current = true;
    setBusy(true);
    setAnswer(null);
    setMessage('正在根据当前档案证据分析…');
    try {
      const res = await fetch('/api/bff/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task, assetId, question: text, requestId: pending.current.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code !== 'AI_TRANSPORT_UNCONFIRMED') pending.current = null;
        setMessage(explain(data.code));
        return;
      }
      if (data.assetId !== assetId) throw new Error();
      setAnswer(data);
      setMessage('');
      if (data.state !== 'running') pending.current = null;
    } catch {
      setMessage(explain('AI_TRANSPORT_UNCONFIRMED'));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <section id="battery-advisor" aria-label="DeepSeek 风险与证据" className="card-surface card-accent-teal space-y-3.5 p-5 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
            <Sparkles className="h-4 w-4 text-teal" />
            <span>智能风险诊断</span>
          </h2>
        </div>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !!blocked}
          onClick={() => void submit('risk_explanation')}
        >
          <Sparkles className="h-3.5 w-3.5" />
          为什么有风险？
        </button>
      </div>

      <label className="block space-y-1.5 font-semibold text-ink-secondary">
        <span>关于这块电池的问题</span>
        <textarea
          className="block w-full rounded-lg border border-line bg-canvas p-2.5 text-xs font-normal text-ink outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
          rows={2}
          maxLength={1000}
          value={question}
          onChange={e => setQuestion(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          className="cursor-pointer rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink transition hover:border-brand/40 hover:bg-subtle/60 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !!blocked || !question.trim()}
          onClick={() => void submit('trace_question')}
        >
          提问并查看依据
        </button>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          读取已保存结果
        </button>
      </div>

      {(blocked || message) && (
        <p role="status" aria-live="polite" className="subtle-surface px-3 py-2 text-xs text-ink-secondary">
          {blocked || message}
        </p>
      )}
      {answer && <AnalysisResult answer={answer} />}
    </section>
  );
}
