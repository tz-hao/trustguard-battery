import { FileSearch } from 'lucide-react';
import { formatDateTime, type BatteryAssetView, type HealthDataView } from '@/lib/types';

export function ProofLink({ field, children }: { field: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="cursor-pointer text-left underline decoration-brand/40 decoration-dotted underline-offset-3 transition hover:text-brand hover:decoration-brand"
      onClick={() => {
        const container = document.getElementById('field-evidence-drawer');
        if (container instanceof HTMLDetailsElement) container.open = true;
        const proof = document.getElementById('proof-' + field);
        if (!(proof instanceof HTMLDetailsElement)) return;
        proof.open = true;
        proof.scrollIntoView({ block: 'center' });
        proof.querySelector('summary')?.focus({ preventScroll: true });
      }}
    >
      {children}
    </button>
  );
}

const evidenceFields = [
  ['code', '电池编码'],
  ['type', '产品类型'],
  ['model', '型号'],
  ['makerCode', '生产厂商'],
  ['chemistry', '材料体系'],
  ['batchId', '生产批次'],
  ['manufacturedAt', '生产日期'],
  ['holderMSP', '当前持有方'],
  ['quality', '有效质检状态'],
  ['state', '生命周期状态'],
  ['parentId', '装配关系'],
  ['installedAt', '装车日期'],
  ['firstUseAt', '首次投用日期'],
  ['serviceAge', '已使用年限'],
  ['designLifeMonths', '设计寿命'],
  ['retiredAt', '实际退役日期'],
  ['recyclingReceivedAt', '回收接收日期'],
  ['scrappedAt', '实际报废日期'],
] as const;

export function FieldEvidence({
  asset,
  history,
  health,
}: {
  asset: BatteryAssetView;
  history: { txId: string; at: string; actorMSP?: string; action?: string; value: BatteryAssetView | null }[];
  health?: { allowed: boolean; data?: HealthDataView };
}) {
  const ordered = history
    .filter(row => row.value && row.value.version <= asset.version)
    .sort((a, b) => a.value!.version - b.value!.version);

  return (
    <details id="field-evidence-drawer" className="card-surface group p-4" aria-label="逐字段证据">
      <summary className="flex cursor-pointer items-center justify-between text-xs font-semibold text-ink-secondary hover:text-ink">
        <span className="flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-brand" />
          <span>展开底层字段链上凭证核查</span>
        </span>
        <span className="text-[11px] text-brand group-open:hidden">点击展开</span>
      </summary>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {evidenceFields.map(([key, label]) => {
          const field = key === 'serviceAge' ? 'firstUseAt' : key;
          const value = asset[field];
          const event = ordered
            .filter(
              (row, i) =>
                row.value![field] === value &&
                (row.value!.version === 1 ||
                  (i > 0 && ordered[i - 1].value!.version + 1 === row.value!.version && ordered[i - 1].value![field] !== value)),
            )
            .at(-1);
          const hash =
            field === 'designLifeMonths'
              ? asset.specSourceHash
              : field === 'makerCode'
                ? asset.makerSource?.sourceHash
                : field === 'manufacturedAt'
                  ? asset.manufactureSourceHash
                  : undefined;
          return (
            <details
              key={key}
              id={`proof-${key}`}
              className="subtle-surface group p-2.5 transition open:border-brand/40 open:bg-white open:shadow-2xs"
            >
              <summary className="flex cursor-pointer items-center justify-between font-semibold text-ink">
                <span>{label}</span>
                <span className="mono ml-2 truncate text-[11px] font-normal text-ink-secondary">
                  {value == null || value === '' ? '未记录' : String(value).slice(0, 14)}
                </span>
              </summary>
              <div className="mt-2 space-y-1 border-t border-line/70 pt-2 text-[11px] text-ink-secondary">
                <p className="mono font-semibold text-ink">{value == null || value === '' ? '暂无已确认记录' : String(value)}</p>
                {key === 'serviceAge' && <p>以首用日期至查询时间 {asset.asOf ?? '未知'} 按上海日历计算</p>}
                {hash && <p className="mono break-all">来源摘要 {hash}</p>}
                {value != null && value !== '' && (
                  <p className="mono break-all">
                    {event
                      ? `Fabric 版本 ${event.value!.version} · ${formatDateTime(event.at)} · ${event.actorMSP ?? '签发机构未记录'} · ${event.action ?? '资产变更'} · 交易 ${event.txId}`
                      : '可用历史未包含字段写入事件'}
                  </p>
                )}
              </div>
            </details>
          );
        })}
        {['SOH 健康度', '循环次数', '剩余寿命', '预计报废日期'].map((label, i) => (
          <details
            id={'proof-' + ['sohPct', 'cycleCount', 'remainingLifeEstimate', 'plannedScrapAt'][i]}
            key={label}
            className="subtle-surface p-2.5 transition open:border-teal/45 open:bg-white open:shadow-2xs"
          >
            <summary className="cursor-pointer font-semibold text-ink">{label}</summary>
            <div className="mt-2 border-t border-line/70 pt-2 text-[11px] text-ink-secondary">
              {!health?.allowed ? (
                <p>健康证据未获授权或不可用</p>
              ) : i >= 2 ? (
                <p>暂无经过验证的寿命预测模型</p>
              ) : health.data?.sourceHash ? (
                <p className="mono break-all">
                  签名健康快照 · {formatDateTime(health.data.measuredAt)} · {health.data.sourceHash}
                </p>
              ) : (
                <p>暂无签名健康快照</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
