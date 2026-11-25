'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { MesImport } from '@/components/MesImport';
import { BatteryScanner } from '@/components/BatteryScanner';
import { FieldEvidence, ProofLink } from '@/components/FieldEvidence';
import { BatteryAdvisor } from '@/components/BatteryAdvisor';
import { ScanObservations } from '@/components/ScanObservations';
import { LifecycleEventCard } from '@/components/identity/LifecycleEventCard';
import { RegistrationDrawer } from '@/components/identity/RegistrationDrawer';
import { scanRequestId } from '@/lib/scan-request-id';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  History,
  Info,
  Lock,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
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
import { ServiceLifeBar, SohGaugeCard } from '@/components/DataCharts';
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
  history?: { txId: string; at: string; value: BatteryAssetView }[];
  inspections?: {
    id: string;
    version: number;
    result: string;
    signerMSP: string;
    at: string;
    reportHash: string;
    txId: string;
  }[];
  edges?: {
    id: string;
    parentId: string;
    childId: string;
    revision: number;
    activeFrom: string;
    activeTo: string | null;
    txId: string;
  }[];
  corrections?: {
    id: string;
    field: string;
    from?: string;
    to?: string;
    oldValue?: string;
    newValue?: string;
    state: string;
    approvals?: { msp: string }[];
  }[];
}

const CODE_SEGMENTS = [
  {
    key: 'maker',
    label: 'X1–X3 厂商',
    fullLabel: '厂商代码（第 1–3 位）',
    range: [0, 3],
    pill: 'bg-brand/[0.06] border-brand/25 text-ink',
    desc: '生产企业厂商代码（3 位大写字母或数字）。',
  },
  {
    key: 'type',
    label: 'X4 类型',
    fullLabel: '产品类别代码（第 4 位）',
    range: [3, 4],
    pill: 'bg-info/[0.08] border-info/30 text-ink',
    desc: 'C＝电池单体（CELL）、M＝电池模块（MODULE）、P＝电池包（PACK）。',
  },
  {
    key: 'chem',
    label: 'X5 材料',
    fullLabel: '电池类型 / 正极材料代码（第 5 位）',
    range: [4, 5],
    pill: 'bg-teal/[0.08] border-teal/30 text-ink',
    desc: 'B＝磷酸铁锂，E＝三元材料，H＝磷酸锰铁锂，J＝钠离子电池。',
  },
  {
    key: 'spec',
    label: 'X6–X7 规格',
    fullLabel: '企业规格代码（第 6–7 位）',
    range: [5, 7],
    pill: 'bg-subtle border-line text-ink',
    desc: '制造企业定义的 2 位产品规格代码。',
  },
  {
    key: 'trace',
    label: 'X8–X14 追溯',
    fullLabel: '企业追溯信息代码（第 8–14 位）',
    range: [7, 14],
    pill: 'bg-brand/[0.05] border-brand/20 text-ink',
    desc: '7 位企业生产产线与批次追溯代码。',
  },
  {
    key: 'date',
    label: 'X15–X17 日期',
    fullLabel: '生产日期代码（第 15–17 位）',
    range: [14, 17],
    pill: 'bg-warning/[0.1] border-warning/35 text-ink',
    desc: '3 位生产年、月、日编码。',
  },
  {
    key: 'serial',
    label: 'X18–X24 序列号',
    fullLabel: '生产序列号（第 18–24 位）',
    range: [17, 24],
    pill: 'bg-teal/[0.06] border-teal/25 text-ink',
    desc: '7 位产品生产唯一序列号。',
  },
] as const;

function IdentityContent() {
  const searchParams = useSearchParams();
  const { actor, capabilities, roleScoped, switchActor, switching } = useIdentity();
  const actorName = actor?.name;
  const initialCode = searchParams.get('code') ?? '';

  const [codeInput, setCodeInput] = useState(initialCode);
  const [response, setResponse] = useState<{ actor?: string; data: BatteryQueryResult } | null>(null);
  const result = response && response.actor === actor?.name ? response.data : null;
  const requestSeq = useRef(0);
  const lastCode = useRef('');
  const [queryError, setQueryError] = useState('');
  const [samples, setSamples] = useState<BatteryAssetView[]>([]);
  const [activeSeg, setActiveSeg] = useState<string>('chem');
  const [evidenceTab, setEvidenceTab] = useState<'history' | 'inspections' | 'edges' | 'corrections'>('history');
  const [loading, setLoading] = useState(false);
  const [sourceInspect, setSourceInspect] = useState<{ field: string; detail: string } | null>(null);
  const [cmdBanner, setCmdBanner] = useState<CommandResultState | null>(null);

  // Registration Drawer
  const [regOpen, setRegOpen] = useState(false);
  const [regBatchSeed, setRegBatchSeed] = useState('ui-batch-demo');

  // Health Snapshot Import
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthSohBp, setHealthSohBp] = useState('9650');
  const [healthCycles, setHealthCycles] = useState('142');
  const [healthBusy, setHealthBusy] = useState(false);

  // Lifecycle Date Correction Flow
  const [corrField, setCorrField] = useState<'installedAt' | 'firstUseAt' | 'retiredAt' | 'scrappedAt'>('firstUseAt');
  const [corrNewVal, setCorrNewVal] = useState('2024-07-02T00:00:00Z');
  const [corrBusy, setCorrBusy] = useState(false);

  // Asset Ledger Filter & Pagination
  const [filterType, setFilterType] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterQuality, setFilterQuality] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [ledgerPage, setLedgerPage] = useState(1);
  const pageSize = 6;

  const fetchBattery = useCallback(
    async (target: string) => {
      const cleaned = target.trim().toUpperCase();
      if (!cleaned || !actorName) return;
      const seq = ++requestSeq.current;
      lastCode.current = cleaned;
      const data = await fetch(`/api/bff/battery?code=${encodeURIComponent(cleaned)}`, { cache: 'no-store' })
        .then(async res => (res.ok ? ((await res.json()) as BatteryQueryResult) : null))
        .catch(() => null);
      if (seq !== requestSeq.current) return;
      setCodeInput(cleaned);
      setResponse(data ? { actor: actorName, data } : null);
      setQueryError(data ? '' : '档案查询失败，请重试');
      setLoading(false);
    },
    [actorName],
  );

  const queryCode = useCallback(
    async (target: string) => {
      const cleaned = target.trim().toUpperCase();
      if (!cleaned) return;
      setCodeInput(cleaned);
      setLoading(true);
      setCmdBanner(null);
      await fetchBattery(cleaned);
    },
    [fetchBattery],
  );

  const refreshAssetsList = useCallback(async () => {
    const res = await fetch('/api/bff/assets', { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as { assets: BatteryAssetView[] };
      setSamples(json.assets);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const seq = requestSeq.current;
    void (async () => {
      const res = await fetch('/api/bff/assets', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as { assets: BatteryAssetView[] };
        if (!active) return;
        setSamples(json.assets);
        if (!initialCode && json.assets.length > 0 && seq === requestSeq.current) {
          const live = json.assets.find(a => a.type === 'PACK' && a.state === 'IN_USE') ?? json.assets[0];
          void fetchBattery(lastCode.current || live.code);
        }
      }
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [initialCode, fetchBattery]);

  useEffect(() => {
    if (initialCode && actor?.name) {
      void fetchBattery(initialCode);
    }
  }, [initialCode, fetchBattery, actor?.name]);

  const [scanFeedback, setScanFeedback] = useState('');
  const [scanRevision, setScanRevision] = useState(0);
  const onScan = useCallback(
    async (code: string, record: boolean) => {
      window.history.replaceState(null, '', `/identity?code=${encodeURIComponent(code)}`);
      void queryCode(code);
      setScanFeedback('');
      if (!record) return;
      try {
        const res = await fetch('/api/bff/scans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, requestId: scanRequestId() }),
        });
        if (!res.ok) throw new Error(res.status === 403 ? '当前角色无权登记' : '站点登记未确认，请核对记录');
        const row = await res.json();
        setScanFeedback(row.previousSite ? `异地冲突预警：${row.previousSite} → ${row.site}` : '本站扫码已记录');
        setScanRevision(n => n + 1);
      } catch (e) {
        setScanFeedback(e instanceof Error ? e.message : '站点登记未确认');
      }
    },
    [queryCode],
  );

  const standaloneSample =
    samples.find(a => a.state === 'REGISTERED' && !a.parentId && a.chemistry === 'LFP') ??
    samples.find(a => a.state === 'REGISTERED' && !a.parentId);
  const liveSample = samples.find(a => a.type === 'PACK' && a.state === 'IN_USE');
  const scrappedSample = samples.find(a => a.type === 'PACK' && a.scrapped);
  const sodiumSample = samples.find(a => a.chemistry === 'SODIUM_ION');

  async function submitHealthImport(e: React.FormEvent) {
    e.preventDefault();
    if (!result?.battery || switching) return;
    setHealthBusy(true);
    setCmdBanner(null);
    try {
      const res = await fetch('/api/bff/imports/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: result.battery.id,
          sohBasisPoints: Number(healthSohBp),
          cycleCount: Number(healthCycles),
          measuredAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        }),
      });
      const json = await res.json();
      if (res.ok && json.stored) {
        setCmdBanner({
          ok: true,
          title: `已签名导入 BMS 健康快照（SOH ${(Number(healthSohBp) / 100).toFixed(2)}%）`,
          requestId: json.requestId,
        });
        setHealthOpen(false);
        await queryCode(result.battery.code);
      } else {
        const errCode = json.code ?? `HTTP_${res.status}`;
        setCmdBanner({
          ok: false,
          title:
            errCode === 'FORBIDDEN'
              ? `BMS 健康快照导入权限不足（需 lab-inspector，当前 ${actor?.name ?? '—'}）`
              : `BMS 健康快照导入失败（当前 ${actor?.name ?? '—'}）`,
          errorCode: errCode,
        });
      }
    } finally {
      setHealthBusy(false);
    }
  }

  async function proposeCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!result?.battery || switching) return;
    setCorrBusy(true);
    setCmdBanner(null);
    const corrId = `ui-corr-${Date.now().toString(36)}`;
    try {
      const res = await fetch('/api/bff/commands/lifecycle-corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            id: corrId,
            assetId: result.battery.id,
            field: corrField,
            newValue: corrNewVal,
            assetVersion: result.battery.version,
          },
          autoHashes: {
            evidenceHash: `corr-ev:${corrId}:${corrNewVal}`,
            reasonHash: `corr-rs:${corrId}:${corrField}`,
          },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setCmdBanner({
          ok: true,
          title: `已提交受控日期更正提案 ${corrId}`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await queryCode(result.battery.code);
      } else {
        setCmdBanner({
          ok: false,
          title: '发起日期更正被拒绝',
          errorCode: json.errorCode ?? json.code ?? 'REJECTED',
        });
      }
    } finally {
      setCorrBusy(false);
    }
  }

  async function actCorrection(
    resource: 'lifecycle-correction-approvals' | 'lifecycle-correction-applications',
    corrId: string,
    label: string,
  ) {
    if (!result?.battery || switching) return;
    setCorrBusy(true);
    setCmdBanner(null);
    try {
      const res = await fetch(`/api/bff/commands/${resource}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: { id: corrId } }),
      });
      const json = await res.json();
      if (json.completed) {
        setCmdBanner({
          ok: true,
          title: `${label} 已上链确认`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await queryCode(result.battery.code);
      } else {
        setCmdBanner({
          ok: false,
          title: `${label} 被拒绝`,
          errorCode: json.errorCode ?? json.code ?? 'REJECTED',
        });
      }
    } finally {
      setCorrBusy(false);
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
          time: result.battery.installedAt
            ? formatDateTime(result.battery.installedAt)
            : `rev ${result.battery.assemblyVersion}`,
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

  const showRegisterAction = !roleScoped || capabilities.canRegisterAnyAsset;
  const showHealthImport = !roleScoped || capabilities.canImportHealth;
  const showLifecycleCard = !roleScoped || capabilities.canAdvanceAnyLifecycle;
  const showMesImport = !roleScoped || capabilities.canRegisterAnyAsset || capabilities.canBindAssembly;

  return (
    <div className="space-y-6">
      <PageBanner
        title="动力电池数字身份证与按码查询工作台"
        right={
          <div className="flex flex-wrap items-center gap-2">
            {showRegisterAction && (
              <button
                type="button"
                onClick={() => {
                  setRegBatchSeed(`ui-batch-${Math.floor(Date.now() / 1000).toString(36)}`);
                  setRegOpen(true);
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
              >
                <Plus className="h-3.5 w-3.5" />
                新建批次 / 24 位码建档
              </button>
            )}
          </div>
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
            <QrCode className="pointer-events-none absolute top-3.5 left-3.5 h-5 w-5 text-brand" />
            <input
              type="text"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.toUpperCase())}
              placeholder="输入或粘贴 24 位 GB/T 34014 动力电池编码（例：DMAPE010000001E11...）"
              className="mono w-full rounded-xl border border-line bg-canvas py-3 pr-20 pl-10 text-xs font-bold tracking-normal text-ink outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15 sm:pr-28 sm:pl-11 sm:text-sm sm:tracking-wider"
            />
            <span
              className={`mono absolute top-3 right-3 rounded-md px-2 py-1 text-[11px] font-bold ${
                codeInput.trim().length === 24 ? 'bg-success/15 text-success' : 'bg-subtle text-ink-secondary'
              }`}
            >
              {codeInput.trim().length} / 24 位
            </span>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-brand-hover disabled:opacity-60"
          >
            <Search className="h-4 w-4" />
            {loading ? '链上核验中...' : '按码查询'}
          </button>
        </form>

        <BatteryScanner onRead={onScan} />

        {scanFeedback && (
          <p
            role="status"
            className={`mt-2.5 rounded-lg border px-3 py-2 text-xs font-semibold ${
              scanFeedback.includes('冲突')
                ? 'border-danger/35 bg-danger/10 text-danger'
                : 'border-success/35 bg-success/10 text-[#0c5e47]'
            }`}
          >
            {scanFeedback}
          </p>
        )}
        {queryError && (
          <p role="alert" className="mt-2.5 rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger">
            {queryError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-ink-secondary">快捷示例：</span>
          {standaloneSample && (
            <button
              type="button"
              onClick={() => void queryCode(standaloneSample.code)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-1.5 font-medium text-ink transition hover:border-brand/50 hover:bg-white"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
              未装配电芯
            </button>
          )}
          {liveSample && (
            <button
              type="button"
              onClick={() => void queryCode(liveSample.code)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/[0.06] px-3 py-1.5 font-medium text-brand transition hover:border-brand/55 hover:bg-brand/12"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              使用中电池包
            </button>
          )}
          {scrappedSample && (
            <button
              type="button"
              onClick={() => void queryCode(scrappedSample.code)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-subtle/80 px-3 py-1.5 font-medium text-navy-900 transition hover:border-navy-800/40 hover:bg-white"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-navy-800" />
              已报废电池包
            </button>
          )}
          {sodiumSample && (
            <button
              type="button"
              onClick={() => void queryCode(sodiumSample.code)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal/30 bg-teal/[0.06] px-3 py-1.5 font-medium text-teal transition hover:border-teal/55 hover:bg-teal/12"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal" />
              钠离子电池 (J)
            </button>
          )}
          <button
            type="button"
            onClick={() => void queryCode('DMAPI010000001E110000100')}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-1.5 font-medium text-danger transition hover:border-danger/55 hover:bg-danger/12"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            非法编码反例
          </button>
        </div>
      </div>

      {/* GB/T 34014 编码结构解析尺 */}
      {result && (
        <div className="card-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              {result.codeValid ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              )}
              <div>
                <h2 className="text-sm font-bold text-ink">
                  {result.codeValid
                    ? 'GB/T 34014 编码结构解析通过'
                    : `编码解析拒绝：${result.parseError?.code ?? 'INVALID_CODE'}`}
                </h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {result.codeValid && result.parsed
                    ? `标准版本：${result.parsed.standardVersion}`
                    : ERROR_DESCRIPTIONS[result.parseError?.code ?? ''] ?? '编码长度、材料类型或日期代码不合规'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-[1.05fr_0.75fr_0.75fr_0.85fr_1.75fr_1.05fr_1.75fr]">
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
                  className={`cursor-pointer rounded-xl border p-2.5 text-left transition ${
                    isErrorSeg
                      ? 'border-danger bg-danger/10 text-danger ring-2 ring-danger/30'
                      : isSelected
                        ? `${seg.pill} ring-2 ring-brand/40 shadow-2xs`
                        : `${seg.pill} opacity-85 hover:opacity-100`
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="truncate">{seg.label}</span>
                    <span className="mono ml-1 shrink-0 text-[10px] opacity-65">
                      {seg.range[0] + 1}–{seg.range[1]}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-nowrap gap-0.5 overflow-x-auto">
                    {slice.split('').map((ch, idx) => (
                      <span
                        key={idx}
                        className="mono inline-flex h-6 min-w-[18px] items-center justify-center rounded border border-line bg-white px-0.5 text-[11px] font-bold text-ink"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="subtle-surface mt-3 px-4 py-2.5 text-xs text-ink">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{selectedSegment.fullLabel}</strong>
              {result.parsed && activeSeg === 'date' && (
                <span className="mono font-semibold text-[#a86e0c]">
                  {result.parsed.dateCode} → 首周期 {result.parsed.productionDateCode.cycleFirstYear}年
                  {result.parsed.productionDateCode.month}月{result.parsed.productionDateCode.day}日（30 年循环）
                </span>
              )}
              {result.parsed?.additionalSpecCodeCandidate && activeSeg === 'trace' && (
                <span className="mono font-semibold text-brand">
                  X8 规格候选位：{result.parsed.additionalSpecCodeCandidate}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-ink-secondary">{selectedSegment.desc}</p>
          </div>
        </div>
      )}

      {/* 结构合规但未登记提示 */}
      {result && result.codeValid && !result.registered && result.parsed && (
        <div className="card-surface card-accent-amber bg-warning/8 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="space-y-1 text-xs text-ink">
              <div className="text-sm font-bold">该编码尚未在链上登记资产档案</div>
              <p className="leading-relaxed text-ink-secondary">
                解析厂商代码 <strong className="mono text-ink">{result.parsed.makerCode}</strong>、产品类型{' '}
                <strong className="text-ink">
                  {PRODUCT_TYPE_LABELS[result.parsed.productType] ?? result.parsed.productType}
                </strong>
                、材料 <strong className="text-ink">{result.parsed.batteryTypeName}</strong>。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 核心档案：电池数字身份证主区 + 物理剖面图 */}
      {result?.battery && (
        <>
          {cmdBanner && <TxResultBanner result={cmdBanner} onClose={() => setCmdBanner(null)} />}

          <div id="id-summary" className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
            {/* 左侧：电池数字身份信息卡 */}
            <div className="card-surface card-accent-blue p-6 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="mono text-base font-bold text-navy-900">{result.battery.id}</div>
                    <div className="text-xs text-ink-secondary">
                      {PRODUCT_TYPE_LABELS[result.battery.type] ?? result.battery.type} · 规格型号 {result.battery.model}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {result.battery.simulation && <DemoTag />}
                  <a className="text-xs font-semibold text-brand underline" href="#battery-advisor">
                    问 AI · 查看风险依据
                  </a>
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
                  className="subtle-surface cursor-pointer p-3 transition hover:border-brand/40 hover:bg-white"
                >
                  <dt className="flex items-center gap-1 text-ink-secondary">
                    电池编码 <Info className="h-3 w-3" />
                  </dt>
                  <dd className="mono mt-1 break-all font-bold text-ink">{result.battery.code}</dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-ink-secondary">
                    <ProofLink field="type">电池类型 / 型号</ProofLink>
                  </dt>
                  <dd className="mt-1 font-bold text-ink">
                    {PRODUCT_TYPE_LABELS[result.battery.type]?.split(' ')[0]} · {result.battery.model}
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-ink-secondary">
                    <ProofLink field="chemistry">材料类型</ProofLink>
                  </dt>
                  <dd className="mt-1 font-bold text-teal">
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
                  className="subtle-surface cursor-pointer p-3 transition hover:border-brand/40 hover:bg-white"
                >
                  <dt className="flex items-center gap-1 text-ink-secondary">
                    生产厂商 <Info className="h-3 w-3" />
                  </dt>
                  <dd className="mt-1 font-bold text-ink">{result.battery.makerName ?? result.battery.makerCode}</dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-ink-secondary">
                    <ProofLink field="manufacturedAt">生产日期</ProofLink>
                  </dt>
                  <dd className="mono mt-1 font-bold text-ink">{result.battery.manufacturedAt}</dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-ink-secondary">
                    <ProofLink field="batchId">生产批次</ProofLink>
                  </dt>
                  <dd className="mono mt-1 font-bold text-brand">
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
                  <dt className="text-ink-secondary">
                    <ProofLink field="state">生产 / 当前状态</ProofLink>
                  </dt>
                  <dd className="mt-1">
                    <LifecycleBadge state={result.battery.state} label={result.battery.statusLabel} />
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-ink-secondary">
                    <ProofLink field="holderMSP">当前登记持有方</ProofLink>
                  </dt>
                  <dd className="mt-1">
                    <OrgBadge mspId={result.battery.holderMSP} />
                  </dd>
                </div>

                <div className="subtle-surface p-3">
                  <dt className="text-ink-secondary">数据来源</dt>
                  <dd className="mono mt-1 text-[11px] font-semibold text-success">
                    {result.battery.evidence?.source ?? 'FABRIC_COMMITTED_STATE'}
                  </dd>
                </div>
              </dl>

              {sourceInspect && (
                <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-info/30 bg-info/10 px-3.5 py-2.5 text-xs text-ink">
                  <span>
                    <strong>{sourceInspect.field}溯源：</strong>
                    {sourceInspect.detail}
                  </span>
                  <button type="button" onClick={() => setSourceInspect(null)} className="shrink-0 cursor-pointer font-semibold underline">
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

                <div className="mb-3 space-y-2.5">
                  <SohGaugeCard
                    sohPct={result.health?.data?.sohPct}
                    allowed={Boolean(result.health?.allowed)}
                    cycleCount={result.health?.data?.cycleCount}
                    measuredAt={result.health?.data?.measuredAt}
                  />
                  <ServiceLifeBar
                    serviceAge={result.battery.serviceAge}
                    designLifeMonths={result.battery.designLifeMonths}
                    state={result.battery.state}
                    manufacturedAt={result.battery.manufacturedAt}
                    installedAt={result.battery.installedAt}
                    firstUseAt={result.battery.firstUseAt}
                    retiredAt={result.battery.retiredAt}
                    scrapped={result.battery.scrapped}
                  />
                </div>

                <div className="mt-3 divide-y divide-line/70 text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="firstUseAt">首次投入使用日期</ProofLink>
                    </span>
                    <span className="mono font-semibold text-ink">
                      {result.battery.firstUseAt ? formatDateTime(result.battery.firstUseAt) : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="serviceAge">已使用年限（Asia/Shanghai）</ProofLink>
                    </span>
                    <span className="font-bold text-brand">{formatServiceAge(result.battery.serviceAge)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="designLifeMonths">厂商设计使用寿命</ProofLink>
                    </span>
                    <span className="mono font-semibold text-ink">
                      {result.battery.designLifeMonths !== null
                        ? `${(result.battery.designLifeMonths / 12).toFixed(1)} 年（${result.battery.designLifeMonths} 个月）`
                        : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="sohPct">SOH 健康度（授权读取）</ProofLink>
                      {result.health?.allowed && result.health.data?.measuredAt && (
                        <small className="block text-[11px] text-ink-muted">
                          测量于 {formatDateTime(result.health.data.measuredAt)}
                        </small>
                      )}
                    </span>
                    <span className="mono font-semibold text-success">
                      {result.health?.allowed
                        ? result.health.data?.sohPct !== null && result.health.data?.sohPct !== undefined
                          ? `${result.health.data.sohPct}%`
                          : '暂无 BMS 快照'
                        : '需持有方/LabOrg 授权'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="plannedScrapAt">预计报废日期（预测）</ProofLink>
                    </span>
                    <span className="font-medium text-ink-secondary">
                      {result.health?.allowed && result.health.data?.plannedScrapAt
                        ? result.health.data.plannedScrapAt
                        : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="retiredAt">实际退役日期</ProofLink>
                    </span>
                    <span className="mono font-semibold text-ink">
                      {result.battery.retiredAt ? formatDateTime(result.battery.retiredAt) : '暂无数据'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-ink-secondary">
                      <ProofLink field="scrappedAt">实际报废日期 / 状态</ProofLink>
                    </span>
                    <span className={`mono font-bold ${result.battery.scrapped ? 'text-danger' : 'text-success'}`}>
                      {result.battery.scrapped && result.battery.scrappedAt
                        ? `已报废 · ${formatDateTime(result.battery.scrappedAt)}`
                        : '未报废（暂无确认记录）'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {(result.battery.originCode || result.battery.echelonCode) && (
            <div className="rounded-xl border border-brand/35 bg-brand/[0.06] px-4 py-3 text-xs text-ink flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold text-brand">梯次利用新旧编码关联：</span>
                {result.battery.originCode ? (
                  <>
                    当前为梯次利用重组电池，原退役编码{' '}
                    <button
                      type="button"
                      onClick={() => void queryCode(result.battery!.originCode!)}
                      className="mono font-bold text-brand underline"
                    >
                      {result.battery.originCode}
                    </button>
                    （不按普通在用电池混淆统计）。
                  </>
                ) : (
                  <>
                    该退役电池已合规转入梯次利用，新编码{' '}
                    <button
                      type="button"
                      onClick={() => void queryCode(result.battery!.echelonCode!)}
                      className="mono font-bold text-brand underline"
                    >
                      {result.battery.echelonCode}
                    </button>
                    （原码已锁定保留关联，非报废处置）。
                  </>
                )}
              </div>
            </div>
          )}

          {result.battery.containingPack && (
            <div className="rounded-xl border border-info/35 bg-info/10 px-4 py-3 text-xs text-ink">
              该组件已装配至电池包{' '}
              <Link
                href={`/trace?assetId=${encodeURIComponent(result.battery.containingPack.id)}`}
                className="mono font-bold text-brand underline"
              >
                {result.battery.containingPack.id}
              </Link>
              （所属包状态：{result.battery.containingPack.state}）。
            </div>
          )}

          {/* 5 节点生命周期时间轴 */}
          <div id="id-lifecycle" className="card-surface p-5">
            <SectionHeader
              title="电池全生命周期时间轴"
              icon={<Clock className="h-4 w-4 text-brand" />}
              action={<SourceTag source="链上状态" />}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {lifecycleMilestones.map((m, idx) => (
                <div
                  key={m.key}
                  className={`rounded-xl border p-3.5 text-xs transition ${
                    m.active
                      ? 'border-brand bg-brand/[0.06] ring-1 ring-brand/30'
                      : m.done
                        ? 'border-success/35 bg-success/[0.05]'
                        : 'border-line bg-canvas opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="mono text-[11px] font-bold text-ink-secondary">0{idx + 1}</span>
                    {m.done ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-ink-muted" />
                    )}
                  </div>
                  <div className="mt-1.5 font-bold text-ink">{m.label}</div>
                  <div className="mono mt-1 truncate text-[11px] font-medium text-ink" title={m.time}>
                    {m.time}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-secondary">{m.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 链上记录 + 受控事件推进（含电池包切换选择器）与健康授权 */}
          <div id="id-records" className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
            <div className={`card-surface p-5 ${showLifecycleCard || showHealthImport || result.health ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
              <SectionHeader
                title="链上记录与历史证据"
                subtitle={`资产版本 v${result.battery.version} · 最后更新 ${formatDateTime(result.battery.updatedAt)}`}
                icon={<History className="h-4 w-4 text-brand" />}
                action={<HashChip value={result.battery.txId} label="最新交易" />}
              />

              <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-subtle p-1 text-xs font-semibold">
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
                    className={`cursor-pointer rounded-md px-3 py-1.5 transition ${
                      evidenceTab === t.key ? 'bg-white text-navy-900 shadow-2xs' : 'text-ink-secondary hover:text-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto pr-1 text-xs">
                {evidenceTab === 'history' &&
                  (result.history ?? []).map((h, i) => (
                    <div
                      key={`${h.txId}-${i}`}
                      className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mono font-bold text-navy-900">v{h.value.version}</span>
                          <LifecycleBadge state={h.value.state} />
                          <OrgBadge mspId={h.value.holderMSP} />
                          <StagePill stage="VALID" />
                        </div>
                        <HashChip value={h.txId} label="txId" />
                      </div>
                      <span className="mono text-[11px] text-ink-secondary">{formatDateTime(h.at)}</span>
                    </div>
                  ))}

                {evidenceTab === 'inspections' &&
                  ((result.inspections ?? []).length === 0 ? (
                    <div className="py-8 text-center text-ink-secondary">暂无直接质检签发记录</div>
                  ) : (
                    (result.inspections ?? []).map(ins => (
                      <div key={ins.id} className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="mono font-bold text-ink">
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
                        <span className="mono text-[11px] text-ink-secondary">{formatDateTime(ins.at)}</span>
                      </div>
                    ))
                  ))}

                {evidenceTab === 'edges' &&
                  ((result.edges ?? []).length === 0 ? (
                    <div className="py-8 text-center text-ink-secondary">暂无装配边记录</div>
                  ) : (
                    (result.edges ?? []).map(edge => (
                      <div key={edge.id} className="subtle-surface flex flex-wrap items-center justify-between gap-2 p-3">
                        <div className="mono font-medium text-ink">
                          rev {edge.revision}：{edge.childId} → {edge.parentId}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                              edge.activeTo ? 'bg-subtle text-ink-secondary' : 'bg-success/15 text-success'
                            }`}
                          >
                            {edge.activeTo ? '历史边' : '现行绑定'}
                          </span>
                          <HashChip value={edge.txId} />
                        </div>
                      </div>
                    ))
                  ))}

                {evidenceTab === 'corrections' && (
                  <div className="space-y-3">
                    {(result.corrections ?? []).length === 0 ? (
                      <div className="py-4 text-center text-ink-secondary">暂无受控日期更正记录</div>
                    ) : (
                      (result.corrections ?? []).map(c => (
                        <div key={c.id} className="subtle-surface p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="mono font-bold text-ink">
                              {c.id} · {c.field}
                            </span>
                            <span className="rounded bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                              {c.state}
                            </span>
                          </div>
                          <div className="mono mt-1 text-[11px] text-ink-secondary">
                            {c.oldValue ?? c.from ?? '空'} → {c.newValue ?? c.to ?? '—'}
                          </div>
                          {c.state !== 'APPLIED' && (!roleScoped || capabilities.canApproveCorrection || capabilities.canProposeCorrection) && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(!roleScoped || capabilities.canApproveCorrection) && (
                                <button
                                  type="button"
                                  disabled={corrBusy || switching}
                                  onClick={() =>
                                    void actCorrection('lifecycle-correction-approvals', c.id, `批准日期更正 ${c.id}`)
                                  }
                                  className="cursor-pointer rounded-md bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                                >
                                  独立批准 (auditor)
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={corrBusy || switching}
                                onClick={() =>
                                  void actCorrection('lifecycle-correction-applications', c.id, `应用日期更正 ${c.id}`)
                                }
                                className="cursor-pointer rounded-md bg-success px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#118061] disabled:opacity-50"
                              >
                                应用生效
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}

                    {result.battery.type === 'PACK' && (!roleScoped || capabilities.canProposeCorrection) && (
                      <form onSubmit={proposeCorrection} className="space-y-2.5 rounded-xl border border-line bg-white p-3.5">
                        <div className="font-bold text-ink">发起受控日期更正提案（仅支持 PACK · 需多方批准）</div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <select
                            value={corrField}
                            onChange={e => setCorrField(e.target.value as typeof corrField)}
                            className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="installedAt">installedAt (装车日期)</option>
                            <option value="firstUseAt">firstUseAt (首次投用)</option>
                            <option value="retiredAt">retiredAt (退役日期)</option>
                            <option value="scrappedAt">scrappedAt (报废确认)</option>
                          </select>
                          <input
                            type="text"
                            value={corrNewVal}
                            onChange={e => setCorrNewVal(e.target.value)}
                            className="mono rounded-lg border border-line px-2.5 py-1.5 text-xs sm:col-span-2"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={corrBusy || switching}
                          className="cursor-pointer rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                        >
                          {corrBusy ? '提交中...' : '发起更正提案 (保留历史账本)'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：分级 BMS 健康数据授权状态 + 受控生命周期事件推进（带电池包下拉切换） */}
            {(showLifecycleCard || showHealthImport || result.health) && (
              <div className="space-y-5 lg:col-span-5">
                <div className="card-surface p-5">
                  <SectionHeader
                    title="分级 BMS 健康数据授权状态"
                    subtitle="最小披露保护：敏感 SOH 数据仅向持有方与 LabOrg 开放"
                    icon={<Cpu className="h-4 w-4 text-teal" />}
                    action={
                      showHealthImport ? (
                        <button
                          type="button"
                          onClick={() => setHealthOpen(v => !v)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-brand transition hover:border-brand"
                        >
                          <Activity className="h-3.5 w-3.5" />
                          {healthOpen ? '收起导入' : '导入健康快照'}
                        </button>
                      ) : undefined
                    }
                  />
                  {healthOpen && showHealthImport && (
                    <form onSubmit={submitHealthImport} className="mb-3 space-y-2.5 rounded-xl border border-line bg-canvas p-3.5 text-xs">
                      <div className="font-semibold text-ink">签名导入模拟 BMS 快照（需 lab-inspector）</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-0.5 block text-[11px] text-ink-secondary">SOH 基点 (9650=96.5%)</label>
                          <input
                            type="number"
                            value={healthSohBp}
                            onChange={e => setHealthSohBp(e.target.value)}
                            className="mono w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-0.5 block text-[11px] text-ink-secondary">循环次数 (cycleCount)</label>
                          <input
                            type="number"
                            value={healthCycles}
                            onChange={e => setHealthCycles(e.target.value)}
                            className="mono w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={healthBusy || switching}
                        className="w-full cursor-pointer rounded-lg bg-teal py-2 text-xs font-semibold text-white transition hover:bg-[#0c8575] disabled:opacity-50"
                      >
                        {healthBusy ? '签名导入中...' : '写入已签名健康快照'}
                      </button>
                    </form>
                  )}
                  {result.health?.allowed && result.health.data ? (
                    <div className="subtle-surface p-3.5 text-xs">
                      <div className="font-bold text-success">已授权读取最新 BMS/检测快照</div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <span className="text-ink-secondary">SOH:</span>{' '}
                          <strong className="mono text-ink">
                            {result.health.data.sohPct !== null && result.health.data.sohPct !== undefined
                              ? `${result.health.data.sohPct}%`
                              : '暂无'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-ink-secondary">循环:</span>{' '}
                          <strong className="mono text-ink">{result.health.data.cycleCount ?? '暂无'}</strong>
                        </div>
                        <div>
                          <span className="text-ink-secondary">剩余寿命:</span>{' '}
                          <strong className="mono text-ink">暂无模型</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-warning/35 bg-warning/10 p-3.5 text-xs text-ink">
                      <div className="flex items-center gap-2 font-bold text-[#a86e0c]">
                        <Lock className="h-4 w-4" />
                        受控拒绝（HTTP {result.health?.status ?? 403} · {result.health?.error?.code ?? 'FORBIDDEN'}）
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary">
                        当前证书 <strong className="mono text-ink">{actor?.name}</strong> 无权查看敏感健康度数据。
                      </p>
                      {!roleScoped && (
                        <button
                          type="button"
                          onClick={() => void switchActor('lab-inspector')}
                          className="mt-2.5 cursor-pointer rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800"
                        >
                          切换为 lab-inspector 查看健康快照
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {showLifecycleCard && (
                  <LifecycleEventCard
                    currentBattery={result.battery}
                    allAssets={samples}
                    onSelectBattery={code => void queryCode(code)}
                    onEventCommitted={async targetCode => {
                      await Promise.allSettled([fetchBattery(targetCode), refreshAssetsList()]);
                    }}
                  />
                )}
              </div>
            )}
          </div>

          <FieldEvidence asset={result.battery} history={result.history ?? []} health={result.health} />
          {actor && !switching && (
            <BatteryAdvisor key={actor.name + ':' + result.battery.id} assetId={result.battery.id} />
          )}
          <ScanObservations key={`${actor?.name}-${result.battery.code}-${scanRevision}`} code={result.battery.code} />
        </>
      )}

      {/* 资产台账筛选与分页表 */}
      <div id="id-ledger" className="card-surface p-5">
        <SectionHeader
          title="链上电池资产台账检索（点击任意资产查看数字身份证）"
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
            className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
          />
          <select
            value={filterType}
            onChange={e => {
              setFilterType(e.target.value);
              setLedgerPage(1);
            }}
            className="rounded-lg border border-line bg-white px-3 py-2 text-xs"
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
            className="rounded-lg border border-line bg-white px-3 py-2 text-xs"
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
            className="rounded-lg border border-line bg-white px-3 py-2 text-xs"
          >
            <option value="">质检状态：全部</option>
            <option value="QC_PASSED">合格 (QC_PASSED)</option>
            <option value="QC_REJECTED">不合格 (QC_REJECTED)</option>
            <option value="REVIEW_REQUIRED">待复核 (REVIEW_REQUIRED)</option>
            <option value="NOT_TESTED">未检测 (NOT_TESTED)</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-line/70">
          <table className="tg-table text-left text-xs">
            <thead>
              <tr>
                <th className="py-2.5 pr-3 pl-3">资产编号 / 24 位编码</th>
                <th className="py-2.5 pr-3">类型</th>
                <th className="py-2.5 pr-3">材料</th>
                <th className="py-2.5 pr-3">生命周期状态</th>
                <th className="py-2.5 pr-3">质检状态</th>
                <th className="py-2.5 pr-3 text-right">持有机构</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {pagedLedger.map(item => {
                const selected = result?.battery?.code === item.code;
                return (
                  <tr
                    key={item.id}
                    onClick={() => void queryCode(item.code)}
                    className={`cursor-pointer transition ${selected ? 'bg-brand/8' : 'hover:bg-canvas'}`}
                  >
                    <td className="py-3 pr-3 pl-2">
                      <div className="mono font-bold text-ink">{item.id}</div>
                      <div className="mono text-[11px] text-ink-secondary">{item.code}</div>
                    </td>
                    <td className="py-3 pr-3 font-medium">
                      {PRODUCT_TYPE_LABELS[item.type]?.split(' ')[0] ?? item.type}
                    </td>
                    <td className="py-3 pr-3">{CHEMISTRY_LABELS[item.chemistry]?.split(' ')[0] ?? item.chemistry}</td>
                    <td className="py-3 pr-3">
                      <LifecycleBadge state={item.state} label={item.statusLabel} />
                    </td>
                    <td className="py-3 pr-3">
                      <QualityBadge quality={item.quality} />
                    </td>
                    <td className="py-3 pr-2 text-right">
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

      {showMesImport && <MesImport />}

      {/* 新增批次与 24 位编码建档抽屉 */}
      <RegistrationDrawer
        open={regOpen}
        onClose={() => setRegOpen(false)}
        initialBatchId={regBatchSeed}
        onRegistered={async code => {
          await refreshAssetsList();
          await queryCode(code);
        }}
      />
    </div>
  );
}

export default function IdentityPage() {
  return (
    <Suspense
      fallback={
        <div className="card-surface space-y-3 p-6">
          <div className="skeleton-block h-6 w-64" />
          <div className="skeleton-block h-24 w-full" />
        </div>
      }
    >
      <IdentityContent />
    </Suspense>
  );
}
