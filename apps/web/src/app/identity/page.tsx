'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  History,
  Info,
  Lock,
  QrCode,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import {
  BatteryQrBadge,
  DemoTag,
  HashChip,
  LifecycleBadge,
  OrgBadge,
  PageBanner,
  QualityBadge,
  SectionHeader,
  SourceTag,
  StagePill,
  TxResultBanner,
  type CommandResultState,
} from '@/components/Badges';
import { BatteryStructureSvg, PaginationBar } from '@/components/Visuals';
import {
  CHEMISTRY_LABELS,
  ERROR_DESCRIPTIONS,
  PRODUCT_TYPE_LABELS,
  formatDateTime,
  formatServiceAge,
  type BatteryAssetView,
  type HealthDataView,
  type ParsedCodeView,
} from '@/lib/types';

interface BatteryQueryResult {
  codeValid: boolean;
  rawCode: string;
  parseError?: { code?: string };
  parsed?: ParsedCodeView;
  registered?: boolean;
  unregisteredReason?: string;
  maker?: { code: string; name: string; msp: string; simulation: boolean; sourceHash: string } | null;
  battery: BatteryAssetView | null;
  health?: { allowed: boolean; status?: number; data?: HealthDataView; error?: { code?: string } };
  history?: { txId: string; timestamp: string; value: BatteryAssetView }[];
  inspections?: { id: string; version: number; result: string; signerMSP: string; at: string; reportHash: string; txId: string }[];
  edges?: { id: string; parentId: string; childId: string; revision: number; activeFrom: string; activeTo: string | null; txId: string }[];
  corrections?: { id: string; field: string; from: string; to: string; state: string; approvals: { msp: string }[] }[];
}

const CODE_SEGMENTS = [
  {
    key: 'maker',
    label: 'X1–X3 厂商',
    fullLabel: '厂商代码（第 1–3 位）',
    range: [0, 3],
    pill: 'bg-[#2563EB]/8 border-[#2563EB]/30 text-[#172B3A]',
    desc: '对应企业备案厂商代码。未接入国家级备案库前，本地仅以 simulation=true 模拟映射企业名称，不冒充官方分配编码。',
  },
  {
    key: 'type',
    label: 'X4 类型',
    fullLabel: '产品类别代码（第 4 位）',
    range: [3, 4],
    pill: 'bg-[#3185D8]/10 border-[#3185D8]/35 text-[#172B3A]',
    desc: 'C＝电池单体（CELL）、M＝电池模块（MODULE）、P＝电池包（PACK）。',
  },
  {
    key: 'chem',
    label: 'X5 材料',
    fullLabel: '电池类型 / 正极材料代码（第 5 位）',
    range: [4, 5],
    pill: 'bg-[#0F9D8A]/10 border-[#0F9D8A]/35 text-[#172B3A]',
    desc: 'B＝磷酸铁锂，E＝三元材料；2026-08-01 实施的第 1 号修改单新增 H＝磷酸锰铁锂、J＝钠离子电池。',
  },
  {
    key: 'spec',
    label: 'X6–X7 规格',
    fullLabel: '企业规格代码（第 6–7 位）',
    range: [5, 7],
    pill: 'bg-[#EDF2F7] border-[#dce4ee] text-[#172B3A]',
    desc: '由制造企业自定义备案的 2 位规格代码，平台不自行猜测规格参数，以产品档案为准。',
  },
  {
    key: 'trace',
    label: 'X8–X14 追溯',
    fullLabel: '企业追溯信息代码（第 8–14 位）',
    range: [7, 14],
    pill: 'bg-[#2563EB]/6 border-[#2563EB]/25 text-[#172B3A]',
    desc: '7 位企业生产追溯代码。依据修改单，X8 可作为企业可选扩展规格位候选，平台保留完整 7 位并返回 candidate 标记。',
  },
  {
    key: 'date',
    label: 'X15–X17 日期',
    fullLabel: '生产日期代码（第 15–17 位）',
    range: [14, 17],
    pill: 'bg-[#D99A2B]/12 border-[#D99A2B]/40 text-[#172B3A]',
    desc: '年代码以 2011 年为起点每 30 年循环；月（1–C）；日（1–0，0 表示 31 日）。需结合来源 manufacturedAt 确定唯一年份。',
  },
  {
    key: 'serial',
    label: 'X18–X24 序列号',
    fullLabel: '生产序列号（第 18–24 位）',
    range: [17, 24],
    pill: 'bg-[#0F9D8A]/8 border-[#0F9D8A]/25 text-[#172B3A]',
    desc: '2026-08-01 前原版要求 7 位十进制数字；修改单生效后允许 7 位大写字母/数字组合，全局唯一检索。',
  },
] as const;

function IdentityContent() {
  const searchParams = useSearchParams();
  const { actor, switchActor } = useIdentity();
  const initialCode = searchParams.get('code') ?? '';

  const [codeInput, setCodeInput] = useState(initialCode);
  const [result, setResult] = useState<BatteryQueryResult | null>(null);
  const [samples, setSamples] = useState<BatteryAssetView[]>([]);
  const [activeSeg, setActiveSeg] = useState<string>('chem');
  const [evidenceTab, setEvidenceTab] = useState<'history' | 'inspections' | 'edges' | 'corrections'>('history');
  const [loading, setLoading] = useState(false);
  const [sourceInspect, setSourceInspect] = useState<{ field: string; detail: string } | null>(null);
  const [cmdBanner, setCmdBanner] = useState<CommandResultState | null>(null);
  const [eventResource, setEventResource] = useState<
    'installations' | 'first-use' | 'retirements' | 'recycling-receipts' | 'scrap-confirmations'
  >('installations');
  const [eventAt, setEventAt] = useState('2026-11-16T08:00:00Z');
  const [submittingEvent, setSubmittingEvent] = useState(false);

  // Asset Ledger Filter & Pagination
  const [filterType, setFilterType] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterQuality, setFilterQuality] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [ledgerPage, setLedgerPage] = useState(1);
  const pageSize = 6;

  const queryCode = useCallback(async (target: string) => {
    const cleaned = target.trim().toUpperCase();
    if (!cleaned) return;
    setCodeInput(cleaned);
    setLoading(true);
    setCmdBanner(null);
    try {
      const res = await fetch(`/api/bff/battery?code=${encodeURIComponent(cleaned)}`, { cache: 'no-store' });
      const data = (await res.json()) as BatteryQueryResult;
      setResult(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/bff/assets', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as { assets: BatteryAssetView[] };
        setSamples(json.assets);
        if (!initialCode && json.assets.length > 0) {
          const live = json.assets.find(a => a.type === 'PACK' && a.state === 'IN_USE') ?? json.assets[0];
          void queryCode(live.code);
        }
      }
    })();
  }, [initialCode, queryCode]);

  useEffect(() => {
    if (initialCode) {
      void queryCode(initialCode);
    }
  }, [initialCode, queryCode, actor?.name]);

  const standaloneSample =
    samples.find(a => a.state === 'REGISTERED' && !a.parentId && a.chemistry === 'LFP') ??
    samples.find(a => a.state === 'REGISTERED' && !a.parentId);
  const liveSample = samples.find(a => a.type === 'PACK' && a.state === 'IN_USE');
  const scrappedSample = samples.find(a => a.type === 'PACK' && a.scrapped);
  const sodiumSample = samples.find(a => a.chemistry === 'SODIUM_ION');

  async function submitLifecycleEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!result?.battery) return;
    setSubmittingEvent(true);
    setCmdBanner(null);
    try {
      const digestBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${eventResource}:${result.battery.id}:${eventAt}`),
      );
      const evidenceHash = [...new Uint8Array(digestBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
      const res = await fetch(`/api/bff/commands/${eventResource}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: { assetId: result.battery.id, at: eventAt, evidenceHash },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setCmdBanner({
          ok: true,
          title: `生命周期事件 ${eventResource} 已上链确认`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await queryCode(result.battery.code);
      } else {
        setCmdBanner({
          ok: false,
          title: `操作被链码拦截：${eventResource}`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage ?? 'rejected',
          errorCode: json.errorCode ?? json.code ?? 'REJECTED',
        });
      }
    } finally {
      setSubmittingEvent(false);
    }
  }

  const selectedSegment = CODE_SEGMENTS.find(s => s.key === activeSeg) ?? CODE_SEGMENTS[2];

  const lifecycleMilestones = result?.battery
    ? [
        {
          key: 'unmounted',
          label: '未装配建档',
          active: result.battery.state === 'REGISTERED',
          done: true,
          time: result.battery.manufacturedAt,
          note: '生产登记完成',
        },
        {
          key: 'assembled',
          label: '已装配成包',
          active: ['ASSEMBLED', 'RELEASED', 'INSTALLED'].includes(result.battery.state),
          done:
            result.battery.assemblyVersion > 0 ||
            ['ASSEMBLED', 'RELEASED', 'INSTALLED', 'IN_USE', 'RETIRED', 'RECEIVED_FOR_RECYCLING', 'PROCESSED'].includes(
              result.battery.state,
            ),
          time: result.battery.installedAt ? formatDateTime(result.battery.installedAt) : `rev ${result.battery.assemblyVersion}`,
          note: result.battery.parentId ? `父级 ${result.battery.parentId}` : `${result.battery.children.length} 子组件`,
        },
        {
          key: 'in_use',
          label: '使用中',
          active: result.battery.state === 'IN_USE',
          done: Boolean(result.battery.firstUseAt),
          time: result.battery.firstUseAt ? formatDateTime(result.battery.firstUseAt) : '暂无首次投用',
          note: result.battery.serviceAge ? `已使用 ${formatServiceAge(result.battery.serviceAge)}` : '不推算年限',
        },
        {
          key: 'retired',
          label: '已退役',
          active: ['RETIRED', 'RECEIVED_FOR_RECYCLING'].includes(result.battery.state),
          done: Boolean(result.battery.retiredAt),
          time: result.battery.retiredAt ? formatDateTime(result.battery.retiredAt) : '尚未退役',
          note: result.battery.recyclingReceivedAt ? '已交回收企业' : '退役非报废',
        },
        {
          key: 'scrapped',
          label: '已报废',
          active: result.battery.scrapped,
          done: result.battery.scrapped,
          time: result.battery.scrappedAt ? formatDateTime(result.battery.scrappedAt) : '未报废',
          note: result.battery.scrapped ? 'RecycleOrg 确认终态' : '无确认凭证',
        },
      ]
    : [];

  const filteredLedger = samples.filter(item => {
    if (filterType && item.type !== filterType) return false;
    if (filterState && item.state !== filterState) return false;
    if (filterQuality && item.quality !== filterQuality) return false;
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      const hay = `${item.id} ${item.code} ${item.model} ${item.batchId ?? ''} ${item.makerName ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const totalLedgerPages = Math.max(1, Math.ceil(filteredLedger.length / pageSize));
  const pagedLedger = filteredLedger.slice((ledgerPage - 1) * pageSize, ledgerPage * pageSize);

  return (
    <div className="space-y-6">
      <PageBanner
        code="02 · BATTERY DIGITAL IDENTITY"
        title="动力电池数字身份证与按码查询工作台"
        subtitle="严格依据 GB/T 34014—2017 及第 1 号修改单解析 24 位编码，关联链上多组织签名生命周期与受控健康档案"
        right={
          actor && (
            <div className="flex items-center gap-2 rounded-lg border border-[#1e3a5c] bg-[#0B192C] px-3 py-1.5 text-xs">
              <span className="text-slate-400">当前查询证书:</span>
              <OrgBadge mspId={actor.mspId} dark />
              <span className="font-semibold text-white">{actor.roleLabel}</span>
            </div>
          )
        }
      />

      {/* 查询输入舱 */}
      <div className="card-surface p-5">
        <form
          onSubmit={e => {
            e.preventDefault();
            void queryCode(codeInput);
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <div className="relative flex-1">
            <QrCode className="pointer-events-none absolute top-3.5 left-3.5 h-5 w-5 text-[#2563EB]" />
            <input
              type="text"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.toUpperCase())}
              placeholder="输入或粘贴 24 位 GB/T 34014 动力电池编码（例：DMAPE010000001E11...）"
              className="mono w-full rounded-xl border border-[#dce4ee] bg-[#F4F7FA] py-3 pr-20 pl-10 text-xs font-bold tracking-normal text-[#172B3A] outline-none focus:border-[#2563EB] focus:bg-white sm:pr-28 sm:pl-11 sm:text-sm sm:tracking-wider"
            />
            <span
              className={`mono absolute top-3 right-3 rounded-md px-2 py-1 text-[11px] font-bold ${
                codeInput.trim().length === 24 ? 'bg-[#159B76]/15 text-[#159B76]' : 'bg-[#EDF2F7] text-[#64748B]'
              }`}
            >
              {codeInput.trim().length} / 24 位
            </span>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Search className="h-4 w-4" />
            {loading ? '链上核验中...' : '按码查询'}
          </button>
          <button
            type="button"
            disabled
            title="当前演示环境未连接实体扫码硬件，请直接输入或点击下方样例编码"
            className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-[#dce4ee] bg-[#EDF2F7] px-4 py-3 text-xs font-medium text-[#94A3B8]"
          >
            扫码硬件未接入
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-[#64748B]">DEMO 演示样例：</span>
          {standaloneSample && (
            <button
              type="button"
              onClick={() => void queryCode(standaloneSample.code)}
              className="rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 font-medium text-[#172B3A] hover:border-[#2563EB]"
            >
              1. 未装配电芯（DEMO）
            </button>
          )}
          {liveSample && (
            <button
              type="button"
              onClick={() => void queryCode(liveSample.code)}
              className="rounded-lg border border-[#2563EB]/30 bg-[#2563EB]/8 px-2.5 py-1.5 font-semibold text-[#2563EB] hover:bg-[#2563EB]/15"
            >
              2. 使用中三元锂电池包（DEMO）
            </button>
          )}
          {scrappedSample && (
            <button
              type="button"
              onClick={() => void queryCode(scrappedSample.code)}
              className="rounded-lg border border-[#10243A] bg-[#10243A] px-2.5 py-1.5 font-semibold text-white hover:bg-[#17324f]"
            >
              3. 已报废电池包（DEMO）
            </button>
          )}
          {sodiumSample && (
            <button
              type="button"
              onClick={() => void queryCode(sodiumSample.code)}
              className="rounded-lg border border-[#0F9D8A]/35 bg-[#0F9D8A]/10 px-2.5 py-1.5 font-medium text-[#0F9D8A] hover:bg-[#0F9D8A]/20"
            >
              修改单钠离子 (J)
            </button>
          )}
          <button
            type="button"
            onClick={() => void queryCode('101PE052011A117AA0000100')}
            className="rounded-lg border border-[#D99A2B]/40 bg-[#D99A2B]/10 px-2.5 py-1.5 font-medium text-[#b07612] hover:bg-[#D99A2B]/20"
          >
            国标附录 A.1 例码（未登记）
          </button>
          <button
            type="button"
            onClick={() => void queryCode('DMAPI010000001E110000100')}
            className="rounded-lg border border-[#DC5353]/35 bg-[#DC5353]/10 px-2.5 py-1.5 font-medium text-[#DC5353] hover:bg-[#DC5353]/20"
          >
            非法编码反例（材料位 I）
          </button>
        </div>
      </div>

      {/* GB/T 34014 编码结构解析尺 */}
      {result && (
        <div className="card-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              {result.codeValid ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#159B76]" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#DC5353]" />
              )}
              <div>
                <h2 className="text-sm font-bold text-[#172B3A]">
                  {result.codeValid
                    ? 'GB/T 34014—2017+A1:2026 编码字段解析通过（CODE_FIELDS_VERIFIED）'
                    : `编码解析拒绝：${result.parseError?.code ?? 'INVALID_CODE'}`}
                </h2>
                <p className="mt-0.5 text-xs text-[#64748B]">
                  {result.codeValid && result.parsed
                    ? `标准版本：${result.parsed.standardVersion} · 范围：${result.parsed.codeScope}（结构校验通过不代表官方厂商备案）`
                    : ERROR_DESCRIPTIONS[result.parseError?.code ?? ''] ?? '编码长度、材料类型或日期代码不合规'}
                </p>
              </div>
            </div>
            {result.parsed && <HashChip value={result.parsed.standardSourceHash} label="标准 PDF SHA-256" />}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {CODE_SEGMENTS.map(seg => {
              const slice = result.rawCode.slice(seg.range[0], seg.range[1]) || '—';
              const isErrorSeg =
                !result.codeValid &&
                ((result.parseError?.code === 'CODE_PRODUCT' && seg.key === 'type') ||
                  (result.parseError?.code === 'CODE_CHEMISTRY' && seg.key === 'chem') ||
                  (result.parseError?.code === 'CODE_DATE' && seg.key === 'date'));
              const isSelected = activeSeg === seg.key;
              return (
                <button
                  type="button"
                  key={seg.key}
                  onClick={() => setActiveSeg(seg.key)}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    isErrorSeg
                      ? 'border-[#DC5353] bg-[#DC5353]/10 text-[#DC5353] ring-2 ring-[#DC5353]/30'
                      : isSelected
                        ? `${seg.pill} ring-2 ring-[#2563EB]/40`
                        : `${seg.pill} opacity-85 hover:opacity-100`
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span>{seg.label}</span>
                    <span className="mono opacity-65">
                      {seg.range[0] + 1}–{seg.range[1]}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {slice.split('').map((ch, idx) => (
                      <span
                        key={idx}
                        className="mono inline-flex h-6 min-w-[20px] items-center justify-center rounded border border-[#dce4ee] bg-white px-1 text-xs font-bold text-[#172B3A]"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="subtle-surface mt-3 px-4 py-2.5 text-xs text-[#172B3A]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{selectedSegment.fullLabel}</strong>
              {result.parsed && activeSeg === 'date' && (
                <span className="mono font-semibold text-[#D99A2B]">
                  {result.parsed.dateCode} → 首周期 {result.parsed.productionDateCode.cycleFirstYear}年
                  {result.parsed.productionDateCode.month}月{result.parsed.productionDateCode.day}日（30 年循环）
                </span>
              )}
              {result.parsed?.additionalSpecCodeCandidate && activeSeg === 'trace' && (
                <span className="mono font-semibold text-[#2563EB]">
                  X8 规格候选位：{result.parsed.additionalSpecCodeCandidate}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-[#64748B]">{selectedSegment.desc}</p>
          </div>
        </div>
      )}

      {/* 结构合规但未登记提示 */}
      {result && result.codeValid && !result.registered && result.parsed && (
        <div className="card-surface border-[#D99A2B]/40 bg-[#D99A2B]/8 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#D99A2B]" />
            <div className="space-y-1 text-xs text-[#172B3A]">
              <div className="text-sm font-bold">
                编码结构符合规范，但尚未在本地链上登记资产（{result.unregisteredReason}）
              </div>
              <p className="text-[#64748B]">
                静态码仅解析出厂商代码 <strong className="mono">{result.parsed.makerCode}</strong>、产品类型{' '}
                <strong>{PRODUCT_TYPE_LABELS[result.parsed.productType] ?? result.parsed.productType}</strong>、材料{' '}
                <strong>{result.parsed.batteryTypeName}</strong>。使用状态、使用年限、退役和报废时间缺少链上事件支撑时，系统明确返回「暂无数据」，绝不自行推算。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 核心档案：电池数字身份证主区 + 物理剖面图 + 使用状态 */}
      {result?.battery && (
        <>
          {cmdBanner && <TxResultBanner result={cmdBanner} onClose={() => setCmdBanner(null)} />}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* 左侧：电池数字身份信息卡 */}
            <div className="card-surface p-6 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EDF2F7] pb-4">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-5 w-5 text-[#2563EB]" />
                  <div>
                    <div className="mono text-base font-bold text-[#10243A]">{result.battery.id}</div>
                    <div className="text-xs text-[#64748B]">
                      {PRODUCT_TYPE_LABELS[result.battery.type] ?? result.battery.type} · 规格型号 {result.battery.model}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {result.battery.simulation && <DemoTag />}
                  <QualityBadge quality={result.battery.quality} />
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                <div
                  onClick={() =>
                    setSourceInspect({
                      field: '电池编码',
                      detail: `GB/T 34014 24 位标准编码 ${result.battery!.code}，与内部资产主键 ${result.battery!.id} 唯一绑定。`,
                    })
                  }
                  className="subtle-surface cursor-pointer p-3 hover:border-[#2563EB]/40"
                >
                  <dt className="flex items-center gap-1 text-[#64748B]">
                    电池编码 <Info className="h-3 w-3" />
                  </dt>
                  <dd className="mono mt-1 break-all font-bold text-[#172B3A]">{result.battery.code}</dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">电池类型 / 型号</dt>
                  <dd className="mt-1 font-bold text-[#172B3A]">
                    {PRODUCT_TYPE_LABELS[result.battery.type]?.split(' ')[0]} · {result.battery.model}
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">材料类型</dt>
                  <dd className="mt-1 font-bold text-[#0F9D8A]">
                    {CHEMISTRY_LABELS[result.battery.chemistry] ?? result.battery.chemistry}
                  </dd>
                </div>

                <div
                  onClick={() =>
                    setSourceInspect({
                      field: '生产厂商',
                      detail: `厂商代码 ${result.battery!.makerCode} 来自本地模拟备案映射（simulation=${String(result.battery!.makerSource?.simulation ?? true)}，sourceHash=${result.battery!.makerSource?.sourceHash ?? '—'}）。`,
                    })
                  }
                  className="subtle-surface cursor-pointer p-3 hover:border-[#2563EB]/40"
                >
                  <dt className="flex items-center gap-1 text-[#64748B]">
                    生产厂商 <Info className="h-3 w-3" />
                  </dt>
                  <dd className="mt-1 font-bold text-[#172B3A]">{result.battery.makerName ?? result.battery.makerCode}</dd>
                  <dd className="text-[10px] text-[#D99A2B]">模拟企业映射</dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">生产日期</dt>
                  <dd className="mono mt-1 font-bold text-[#172B3A]">{result.battery.manufacturedAt}</dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">生产批次</dt>
                  <dd className="mono mt-1 font-bold text-[#2563EB]">
                    {result.battery.batchId ? (
                      <Link href={`/trace?batchId=${encodeURIComponent(result.battery.batchId)}`} className="underline">
                        {result.battery.batchId}
                      </Link>
                    ) : (
                      '暂无独立批次'
                    )}
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">生产 / 当前状态</dt>
                  <dd className="mt-1">
                    <LifecycleBadge state={result.battery.state} label={result.battery.statusLabel} />
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">当前登记持有方</dt>
                  <dd className="mt-1">
                    <OrgBadge mspId={result.battery.holderMSP} />
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-[#64748B]">数据来源</dt>
                  <dd className="mono mt-1 text-[11px] font-semibold text-[#159B76]">
                    {result.battery.evidence?.source ?? 'FABRIC_COMMITTED_STATE'}
                  </dd>
                </div>
              </dl>

              {sourceInspect && (
                <div className="mt-4 flex items-center justify-between rounded-lg border border-[#3185D8]/30 bg-[#3185D8]/10 px-3 py-2 text-xs text-[#172B3A]">
                  <span>
                    <strong>{sourceInspect.field}溯源：</strong>
                    {sourceInspect.detail}
                  </span>
                  <button onClick={() => setSourceInspect(null)} className="font-semibold underline">
                    关闭
                  </button>
                </div>
              )}
            </div>

            {/* 右侧：结构剖面示意图 + 使用状态参数 */}
            <div className="card-surface flex flex-col justify-between p-6 lg:col-span-5">
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <BatteryStructureSvg type={result.battery.type} />
                  </div>
                  <div className="shrink-0">
                    <BatteryQrBadge code={result.battery.code} size={96} />
                  </div>
                </div>

                <div className="mt-3 divide-y divide-[#EDF2F7] text-xs">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">首次投入使用日期</span>
                    <span className="mono font-semibold text-[#172B3A]">
                      {result.battery.firstUseAt ? formatDateTime(result.battery.firstUseAt) : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">已使用年限（Asia/Shanghai）</span>
                    <span className="font-bold text-[#2563EB]">{formatServiceAge(result.battery.serviceAge)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">厂商设计使用寿命</span>
                    <span className="mono font-semibold text-[#172B3A]">
                      {result.battery.designLifeMonths !== null
                        ? `${(result.battery.designLifeMonths / 12).toFixed(1)} 年（${result.battery.designLifeMonths} 个月）`
                        : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">SOH 健康度（授权读取）</span>
                    <span className="mono font-semibold text-[#159B76]">
                      {result.health?.allowed
                        ? result.health.data?.sohPct !== null && result.health.data?.sohPct !== undefined
                          ? `${result.health.data.sohPct}%`
                          : '暂无 BMS 快照'
                        : '需持有方/LabOrg 授权'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">预计报废日期（预测）</span>
                    <span className="font-medium text-[#64748B]">
                      {result.health?.allowed && result.health.data?.plannedScrapAt
                        ? result.health.data.plannedScrapAt
                        : '暂无数据（不自行推算）'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">实际退役日期</span>
                    <span className="mono font-semibold text-[#172B3A]">
                      {result.battery.retiredAt ? formatDateTime(result.battery.retiredAt) : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[#64748B]">实际报废日期 / 状态</span>
                    <span className={`mono font-bold ${result.battery.scrapped ? 'text-[#DC5353]' : 'text-[#159B76]'}`}>
                      {result.battery.scrapped && result.battery.scrappedAt
                        ? `已报废 · ${formatDateTime(result.battery.scrappedAt)}`
                        : '未报废（暂无确认记录）'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {result.battery.containingPack && (
            <div className="rounded-xl border border-[#3185D8]/35 bg-[#3185D8]/10 px-4 py-3 text-xs text-[#172B3A]">
              该组件已装配至电池包{' '}
              <Link
                href={`/trace?assetId=${encodeURIComponent(result.battery.containingPack.id)}`}
                className="mono font-bold text-[#2563EB] underline"
              >
                {result.battery.containingPack.id}
              </Link>
              （所属包状态：{result.battery.containingPack.state}）。子资产不将 PACK 的投用时间冒充为自身使用年限。
            </div>
          )}

          {/* 5 节点生命周期时间轴 */}
          <div className="card-surface p-5">
            <SectionHeader
              title="电池全生命周期时间轴"
              subtitle="未装配 → 已装配 → 使用中 → 已退役 → 已报废（严格基于链上真实提交事件）"
              icon={<Clock className="h-4 w-4 text-[#2563EB]" />}
              action={<SourceTag source="Fabric 状态机约束" />}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {lifecycleMilestones.map((m, idx) => (
                <div
                  key={m.key}
                  className={`rounded-xl border p-3.5 text-xs ${
                    m.active
                      ? 'border-[#2563EB] bg-[#2563EB]/8 ring-1 ring-[#2563EB]/30'
                      : m.done
                        ? 'border-[#159B76]/35 bg-[#159B76]/6'
                        : 'border-[#dce4ee] bg-[#F4F7FA] opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="mono text-[10px] font-bold text-[#64748B]">0{idx + 1}</span>
                    {m.done ? (
                      <CheckCircle2 className="h-4 w-4 text-[#159B76]" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-[#94A3B8]" />
                    )}
                  </div>
                  <div className="mt-1.5 font-bold text-[#172B3A]">{m.label}</div>
                  <div className="mono mt-1 truncate text-[11px] font-medium text-[#172B3A]" title={m.time}>
                    {m.time}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#64748B]">{m.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 链上记录 + 受控事件与健康授权 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="card-surface p-5 lg:col-span-7">
              <SectionHeader
                title="链上记录与历史证据"
                subtitle={`资产版本 v${result.battery.version} · 最后更新 ${formatDateTime(result.battery.updatedAt)}`}
                icon={<History className="h-4 w-4 text-[#2563EB]" />}
                action={<HashChip value={result.battery.txId} label="最新交易" />}
              />

              <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-[#EDF2F7] p-1 text-xs font-semibold">
                {[
                  { key: 'history', label: `状态变更历史 (${result.history?.length ?? 0})` },
                  { key: 'inspections', label: `质检版本 (${result.inspections?.length ?? 0})` },
                  { key: 'edges', label: `装配边 (${result.edges?.length ?? 0})` },
                  { key: 'corrections', label: `日期更正 (${result.corrections?.length ?? 0})` },
                ].map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setEvidenceTab(t.key as typeof evidenceTab)}
                    className={`rounded-md px-3 py-1.5 transition ${
                      evidenceTab === t.key ? 'bg-white text-[#10243A] shadow-2xs' : 'text-[#64748B] hover:text-[#172B3A]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
                {evidenceTab === 'history' &&
                  (result.history ?? []).map((h, i) => (
                    <div
                      key={`${h.txId}-${i}`}
                      className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mono font-bold text-[#10243A]">v{h.value.version}</span>
                          <LifecycleBadge state={h.value.state} />
                          <OrgBadge mspId={h.value.holderMSP} />
                          <StagePill stage="VALID" />
                        </div>
                        <HashChip value={h.txId} label="txId" />
                      </div>
                      <span className="mono text-[11px] text-[#64748B]">{formatDateTime(h.timestamp)}</span>
                    </div>
                  ))}

                {evidenceTab === 'inspections' &&
                  ((result.inspections ?? []).length === 0 ? (
                    <div className="py-8 text-center text-[#64748B]">暂无直接质检签发记录</div>
                  ) : (
                    (result.inspections ?? []).map(ins => (
                      <div key={ins.id} className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="mono font-bold text-[#172B3A]">
                              {ins.id} (v{ins.version})
                            </span>
                            <QualityBadge quality={ins.result} />
                            <OrgBadge mspId={ins.signerMSP} />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <HashChip value={ins.reportHash} label="报告哈希" />
                            <HashChip value={ins.txId} label="txId" />
                          </div>
                        </div>
                        <span className="mono text-[11px] text-[#64748B]">{formatDateTime(ins.at)}</span>
                      </div>
                    ))
                  ))}

                {evidenceTab === 'edges' &&
                  ((result.edges ?? []).length === 0 ? (
                    <div className="py-8 text-center text-[#64748B]">暂无装配边记录</div>
                  ) : (
                    (result.edges ?? []).map(edge => (
                      <div key={edge.id} className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3">
                        <div className="mono font-medium">
                          rev {edge.revision}：{edge.childId} → {edge.parentId}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              edge.activeTo ? 'bg-[#EDF2F7] text-[#64748B]' : 'bg-[#159B76]/15 text-[#159B76]'
                            }`}
                          >
                            {edge.activeTo ? '历史边' : '现行绑定'}
                          </span>
                          <HashChip value={edge.txId} />
                        </div>
                      </div>
                    ))
                  ))}

                {evidenceTab === 'corrections' &&
                  ((result.corrections ?? []).length === 0 ? (
                    <div className="py-8 text-center text-[#64748B]">暂无受控日期更正记录</div>
                  ) : (
                    (result.corrections ?? []).map(c => (
                      <div key={c.id} className="subtle-surface p-3">
                        <div className="flex items-center justify-between">
                          <span className="mono font-bold">
                            {c.id} · {c.field}
                          </span>
                          <span className="rounded bg-[#2563EB]/10 px-2 py-0.5 text-[10px] font-bold text-[#2563EB]">{c.state}</span>
                        </div>
                        <div className="mono mt-1 text-[11px] text-[#64748B]">
                          {c.from} → {c.to}
                        </div>
                      </div>
                    ))
                  ))}
              </div>
            </div>

            {/* 受控事件提交 + BMS 权限说明 */}
            <div className="space-y-5 lg:col-span-5">
              <div className="card-surface p-5">
                <SectionHeader
                  title="分级 BMS 健康数据授权状态"
                  subtitle="最小披露保护：敏感 SOH 数据仅向持有方与 LabOrg 开放"
                  icon={<Cpu className="h-4 w-4 text-[#0F9D8A]" />}
                />
                {result.health?.allowed && result.health.data ? (
                  <div className="subtle-surface p-3.5 text-xs">
                    <div className="font-bold text-[#159B76]">已授权读取最新 BMS/检测快照</div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-[#64748B]">SOH:</span>{' '}
                        <strong className="mono">{result.health.data.sohPct ?? '暂无'}%</strong>
                      </div>
                      <div>
                        <span className="text-[#64748B]">循环:</span>{' '}
                        <strong className="mono">{result.health.data.cycleCount ?? '暂无'}</strong>
                      </div>
                      <div>
                        <span className="text-[#64748B]">剩余寿命:</span>{' '}
                        <strong className="mono">暂无模型</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#D99A2B]/35 bg-[#D99A2B]/10 p-3.5 text-xs text-[#172B3A]">
                    <div className="flex items-center gap-2 font-bold text-[#b07612]">
                      <Lock className="h-4 w-4" />
                      受控拒绝（HTTP {result.health?.status ?? 403} · {result.health?.error?.code ?? 'FORBIDDEN'}）
                    </div>
                    <p className="mt-1 text-[11px] text-[#64748B]">
                      当前证书 <strong className="mono">{actor?.name}</strong> 无权查看敏感健康度数据。
                    </p>
                    <button
                      type="button"
                      onClick={() => void switchActor('lab-inspector')}
                      className="mt-2.5 rounded-lg bg-[#10243A] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#17324f]"
                    >
                      切换为 lab-inspector 查看健康快照
                    </button>
                  </div>
                )}
              </div>

              <div className="card-surface p-5">
                <SectionHeader
                  title="受控生命周期事件推进"
                  subtitle="按顶部证书向链码提交装车、首用、退役或报废事件"
                  icon={<Wrench className="h-4 w-4 text-[#2563EB]" />}
                />
                <form onSubmit={submitLifecycleEvent} className="space-y-3 text-xs">
                  <select
                    value={eventResource}
                    onChange={e => setEventResource(e.target.value as typeof eventResource)}
                    className="w-full rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
                  >
                    <option value="installations">装车登记 (RecordInstallation · PackOrg operator)</option>
                    <option value="first-use">首次投入使用 (RecordFirstUse · PackOrg operator)</option>
                    <option value="retirements">退役登记 (RecordRetirement · 持有方 operator)</option>
                    <option value="recycling-receipts">回收接收确认 (ConfirmRecycling · RecycleOrg recycler)</option>
                    <option value="scrap-confirmations">正式报废确认 (RecordScrapConfirmation · RecycleOrg recycler)</option>
                  </select>
                  <input
                    type="text"
                    value={eventAt}
                    onChange={e => setEventAt(e.target.value)}
                    className="mono w-full rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-3 py-2 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={submittingEvent}
                    className="w-full rounded-lg bg-[#10243A] py-2 text-xs font-semibold text-white hover:bg-[#17324f] disabled:opacity-60"
                  >
                    {submittingEvent ? '链码背书提交中...' : `以 ${actor?.name ?? '当前身份'} 提交事件`}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 资产台账筛选与分页表（呼应效果图 1：资产查询工作台） */}
      <div className="card-surface p-5">
        <SectionHeader
          title="链上电池资产台账检索（点击任意资产查看数字身份证）"
          subtitle="来自 PostgreSQL 可重建索引与 Fabric 账本投影，支持多维度筛选与分页"
        />
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            type="text"
            value={filterSearch}
            onChange={e => {
              setFilterSearch(e.target.value);
              setLedgerPage(1);
            }}
            placeholder="搜索资产 ID、编码、型号或批次..."
            className="rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-3 py-2 text-xs outline-none focus:border-[#2563EB] focus:bg-white"
          />
          <select
            value={filterType}
            onChange={e => {
              setFilterType(e.target.value);
              setLedgerPage(1);
            }}
            className="rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
          >
            <option value="">类型：全部</option>
            <option value="CELL">电芯 (CELL)</option>
            <option value="MODULE">模组 (MODULE)</option>
            <option value="PACK">电池包 (PACK)</option>
          </select>
          <select
            value={filterState}
            onChange={e => {
              setFilterState(e.target.value);
              setLedgerPage(1);
            }}
            className="rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
          >
            <option value="">生命周期：全部</option>
            <option value="REGISTERED">未装配 (REGISTERED)</option>
            <option value="ASSEMBLED">已装配 (ASSEMBLED)</option>
            <option value="IN_USE">使用中 (IN_USE)</option>
            <option value="RETIRED">已退役 (RETIRED)</option>
            <option value="PROCESSED">已处理/报废 (PROCESSED)</option>
          </select>
          <select
            value={filterQuality}
            onChange={e => {
              setFilterQuality(e.target.value);
              setLedgerPage(1);
            }}
            className="rounded-lg border border-[#dce4ee] bg-white px-3 py-2 text-xs"
          >
            <option value="">质检状态：全部</option>
            <option value="QC_PASSED">合格 (QC_PASSED)</option>
            <option value="QC_REJECTED">不合格 (QC_REJECTED)</option>
            <option value="REVIEW_REQUIRED">待复核 (REVIEW_REQUIRED)</option>
            <option value="NOT_TESTED">未检测 (NOT_TESTED)</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#dce4ee] text-[11px] text-[#64748B]">
              <tr>
                <th className="py-2.5 pr-3">资产编号 / 24 位编码</th>
                <th className="py-2.5 pr-3">类型</th>
                <th className="py-2.5 pr-3">材料</th>
                <th className="py-2.5 pr-3">生命周期状态</th>
                <th className="py-2.5 pr-3">质检状态</th>
                <th className="py-2.5 text-right">持有机构</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2F7]">
              {pagedLedger.map(item => {
                const selected = result?.battery?.code === item.code;
                return (
                  <tr
                    key={item.id}
                    onClick={() => void queryCode(item.code)}
                    className={`cursor-pointer transition ${selected ? 'bg-[#2563EB]/10' : 'hover:bg-[#F4F7FA]'}`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="mono font-bold text-[#172B3A]">{item.id}</div>
                      <div className="mono text-[10px] text-[#64748B]">{item.code}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-medium">{PRODUCT_TYPE_LABELS[item.type]?.split(' ')[0] ?? item.type}</td>
                    <td className="py-2.5 pr-3">{CHEMISTRY_LABELS[item.chemistry]?.split(' ')[0] ?? item.chemistry}</td>
                    <td className="py-2.5 pr-3">
                      <LifecycleBadge state={item.state} label={item.statusLabel} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <QualityBadge quality={item.quality} />
                    </td>
                    <td className="py-2.5 text-right">
                      <OrgBadge mspId={item.holderMSP} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationBar
          page={ledgerPage}
          totalPages={totalLedgerPages}
          totalItems={filteredLedger.length}
          onPageChange={setLedgerPage}
        />
      </div>
    </div>
  );
}

export default function IdentityPage() {
  return (
    <Suspense fallback={<div className="card-surface p-8 text-center text-sm text-[#64748B]">正在加载电池数字身份工作台...</div>}>
      <IdentityContent />
    </Suspense>
  );
}
