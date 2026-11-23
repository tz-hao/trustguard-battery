'use client';

import React, { useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';
import { TxResultBanner, type CommandResultState } from '@/components/Badges';
import { SlideDrawer } from '@/components/Visuals';
import { useIdentity } from '@/components/IdentityProvider';

const YEAR_CODES = '123456789ABCDEFGHJKLMNPRSTVWXY';
const MONTH_CODES = '123456789ABC';
const DAY_CODES = '123456789ABCDEFGHJKLMNPRSTVWXY0';

function encodeGbtDate(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2011 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  const yChar = YEAR_CODES[(year - 2011) % 30];
  const mChar = MONTH_CODES[month - 1];
  const dChar = DAY_CODES[day - 1];
  return `${yChar}${mChar}${dChar}`;
}

function buildStandardCode(kind: 'CELL' | 'MODULE' | 'PACK', chem: 'B' | 'E' | 'J', mfgDate: string): string {
  const prefix = kind === 'CELL' ? 'SMA' : 'DMA';
  const tc = kind === 'CELL' ? 'C' : kind === 'MODULE' ? 'M' : 'P';
  const dateCode = encodeGbtDate(mfgDate) ?? 'E11';
  const serial = String(Math.floor(1000000 + Math.random() * 8000000));
  return `${prefix}${tc}${chem}010000001${dateCode}${serial}`;
}

export function RegistrationDrawer({
  open,
  onClose,
  initialBatchId,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  initialBatchId: string;
  onRegistered: (code: string) => Promise<void>;
}) {
  const { actor } = useIdentity();
  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      title="新增模拟电芯批次与 24 位标准编码建档"
      subtitle={`当前操作证书：${actor?.name ?? '加载中...'} · 严格执行 GB/T 34014 编码、日期与组织归属校验`}
    >
      {open && (
        <RegistrationDrawerBody
          key={`${initialBatchId}-${actor?.mspId ?? ''}`}
          initialBatchId={initialBatchId}
          onRegistered={onRegistered}
        />
      )}
    </SlideDrawer>
  );
}

function RegistrationDrawerBody({
  initialBatchId,
  onRegistered,
}: {
  initialBatchId: string;
  onRegistered: (code: string) => Promise<void>;
}) {
  const { actor, loading: identityLoading, switching, roleScoped, switchActor } = useIdentity();

  const initialKind: 'CELL' | 'MODULE' | 'PACK' =
    actor?.mspId === 'PackOrgMSP' && actor.role === 'manufacturer' ? 'MODULE' : 'CELL';

  const [regBusy, setRegBusy] = useState(false);
  const [regBanner, setRegBanner] = useState<CommandResultState | null>(null);
  const [regBatchId, setRegBatchId] = useState(initialBatchId);
  const [regKind, setRegKind] = useState<'CELL' | 'MODULE' | 'PACK'>(initialKind);
  const [regChem, setRegChem] = useState<'B' | 'E' | 'J'>('B');
  const [regMfgDate, setRegMfgDate] = useState('2024-01-01');
  const [regCode, setRegCode] = useState(() => buildStandardCode(initialKind, 'B', '2024-01-01'));
  const [regLifeMonths, setRegLifeMonths] = useState('96');

  const canCreateBatch = actor?.mspId === 'CellOrgMSP' && actor?.role === 'manufacturer';
  const requiredActorForKind = regKind === 'CELL' ? 'cell-manufacturer' : 'pack-manufacturer';
  const requiredMspForKind = regKind === 'CELL' ? 'CellOrgMSP' : 'PackOrgMSP';
  const canRegisterSelectedKind = actor?.mspId === requiredMspForKind && actor?.role === 'manufacturer';

  async function createBatchFlow(e: React.FormEvent) {
    e.preventDefault();
    const batchId = regBatchId.trim();
    if (!batchId || regBusy || identityLoading || switching) return;
    setRegBusy(true);
    setRegBanner(null);
    try {
      const lotId = `${batchId}-lot`;
      const lotRes = await fetch('/api/bff/commands/material-lots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: { id: lotId, ownerMSP: 'CellOrgMSP', simulation: true },
          autoHashes: { sourceHash: `lot:${lotId}` },
        }),
      });
      const lotJson = await lotRes.json();
      const lotCode = lotJson.errorCode ?? lotJson.code;
      if (!lotJson.completed && lotCode !== 'ALREADY_EXISTS') {
        setRegBanner({
          ok: false,
          title:
            lotCode === 'FORBIDDEN'
              ? `创建原料批次权限不足（需 cell-manufacturer，当前 ${actor?.name ?? '—'}）`
              : `创建原料批次失败（${lotId}）`,
          requestId: lotJson.requestId,
          stage: lotJson.stage,
          errorCode: lotCode ?? 'REJECTED',
        });
        return;
      }

      const res = await fetch('/api/bff/commands/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: { id: batchId, makerMSP: 'CellOrgMSP', materialLotIds: [lotId], simulation: true },
        }),
      });
      const json = await res.json();
      const errCode = json.errorCode ?? json.code;
      setRegBanner(
        json.completed
          ? {
              ok: true,
              title: `已创建原料与电芯生产批次 ${batchId}`,
              requestId: json.requestId,
              txId: json.txId,
              stage: json.stage,
              blockNumber: json.blockNumber,
            }
          : {
              ok: false,
              title:
                errCode === 'FORBIDDEN'
                  ? `创建电芯批次权限不足（需 cell-manufacturer，当前 ${actor?.name ?? '—'}）`
                  : `创建生产批次失败（${batchId}）`,
              requestId: json.requestId,
              stage: json.stage,
              errorCode: errCode ?? 'REJECTED',
            },
      );
    } finally {
      setRegBusy(false);
    }
  }

  async function registerBatteryFlow(e: React.FormEvent) {
    e.preventDefault();
    if (regBusy || identityLoading || switching) return;
    const code = regCode.trim().toUpperCase();
    const assetId = `ui-${regKind.toLowerCase()}-${Date.now().toString(36)}`;
    setRegBusy(true);
    setRegBanner(null);
    try {
      const res = await fetch('/api/bff/commands/assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: {
            id: assetId,
            code,
            batchId: regKind === 'CELL' ? regBatchId.trim() : '',
            model: 'sim-3000',
            manufacturedAt: regMfgDate,
            designLifeMonths: Number(regLifeMonths) || 96,
          },
          autoHashes: {
            manufactureSourceHash: `mfg:${assetId}:${code}`,
            specSourceHash: `spec:${assetId}:sim-3000`,
          },
        }),
      });
      const json = await res.json();
      if (json.completed) {
        setRegBanner({
          ok: true,
          title: `24 位编码建档成功：${assetId}`,
          requestId: json.requestId,
          txId: json.txId,
          stage: json.stage,
          blockNumber: json.blockNumber,
        });
        await onRegistered(code);
      } else {
        const errCode = json.errorCode ?? json.code ?? 'REJECTED';
        setRegBanner({
          ok: false,
          title:
            errCode === 'FORBIDDEN'
              ? `编码建档权限不匹配（${regKind} 需 ${requiredActorForKind}，当前 ${actor?.name ?? '—'}）`
              : `编码建档被拒绝（当前 ${actor?.name ?? '—'}）`,
          requestId: json.requestId,
          stage: json.stage,
          errorCode: errCode,
        });
      }
    } finally {
      setRegBusy(false);
    }
  }

  return (
    <div className="space-y-5 text-xs">
        {regBanner && <TxResultBanner result={regBanner} onClose={() => setRegBanner(null)} />}

        {!roleScoped && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-secondary">快捷切身份：</span>
            <button
              type="button"
              disabled={switching}
              onClick={() => {
                void switchActor('cell-manufacturer');
                setRegKind('CELL');
                setRegCode(buildStandardCode('CELL', regChem, regMfgDate));
              }}
              className={`mono cursor-pointer rounded-md border px-2.5 py-1 font-medium transition ${
                actor?.name === 'cell-manufacturer'
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-line bg-canvas text-ink hover:border-brand'
              }`}
            >
              cell-manufacturer (建电芯/批次)
            </button>
            <button
              type="button"
              disabled={switching}
              onClick={() => {
                void switchActor('pack-manufacturer');
                setRegKind('MODULE');
                setRegCode(buildStandardCode('MODULE', regChem, regMfgDate));
              }}
              className={`mono cursor-pointer rounded-md border px-2.5 py-1 font-medium transition ${
                actor?.name === 'pack-manufacturer'
                  ? 'border-teal bg-teal/10 text-teal'
                  : 'border-line bg-canvas text-ink hover:border-teal'
              }`}
            >
              pack-manufacturer (建模组/PACK)
            </button>
          </div>
        )}

        {/* Step 1: Create Batch */}
        <form onSubmit={e => void createBatchFlow(e)} className="subtle-surface space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-ink">步骤 1：创建原料批次 &amp; 电芯生产批次 (cell-manufacturer)</div>
            {canCreateBatch ? (
              <span className="inline-flex items-center gap-1 rounded bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                <CheckCircle2 className="h-3 w-3" /> 证书匹配
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-[#a86e0c]">
                <ShieldAlert className="h-3 w-3" /> 需 cell-manufacturer
              </span>
            )}
          </div>
          <div>
            <label htmlFor="reg-batch-id" className="mb-1 block font-semibold text-ink-secondary">
              批次号 (batchId)
            </label>
            <input
              id="reg-batch-id"
              type="text"
              value={regBatchId}
              onChange={e => setRegBatchId(e.target.value)}
              className="mono w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <button
            type="submit"
            disabled={regBusy || identityLoading || switching}
            className="w-full cursor-pointer rounded-lg bg-navy-900 py-2 font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {regBusy ? '提交中...' : '提交并创建生产批次'}
          </button>
        </form>

        {/* Step 2: Register 24-Char Asset */}
        <form onSubmit={e => void registerBatteryFlow(e)} className="subtle-surface space-y-3 p-4">
          <div className="font-bold text-ink">步骤 2：按 GB/T 34014 24 位编码登记新电池资产</div>

          {/* Explicit Organization-to-Product-Tier Permission Guard Banner (Fixes Bug 1 confusion) */}
          {!canRegisterSelectedKind && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/12 px-3 py-2 text-[11px] text-[#8a5808]">
              <span className="flex items-center gap-1.5 leading-snug">
                <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
                <span>
                  {regKind === 'CELL'
                    ? `电芯单体 (CELL · SMA) 须由 cell-manufacturer 登记，当前为 ${actor?.name ?? '未加载'}。`
                    : `${regKind === 'MODULE' ? '电池模组 (MODULE)' : '动力电池包 (PACK)'} (DMA) 须由 pack-manufacturer 登记，当前 ${actor?.name ?? '未加载'} 仅可登记电芯。`}
                </span>
              </span>
              {!roleScoped && (
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => void switchActor(requiredActorForKind)}
                  className="mono cursor-pointer rounded-md border border-warning/45 bg-white px-2 py-0.5 font-semibold text-ink hover:border-brand"
                >
                  切换为 {requiredActorForKind}
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="reg-kind" className="mb-1 block font-semibold text-ink-secondary">
                层级类型（按组织授权）
              </label>
              <select
                id="reg-kind"
                value={regKind}
                onChange={e => {
                  const k = e.target.value as 'CELL' | 'MODULE' | 'PACK';
                  setRegKind(k);
                  setRegCode(buildStandardCode(k, regChem, regMfgDate));
                }}
                className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-xs outline-none focus:border-brand"
              >
                <option value="CELL">电芯单体 (CELL · SMA · 需 cell-manufacturer)</option>
                <option value="MODULE">电池模组 (MODULE · DMA · 需 pack-manufacturer)</option>
                <option value="PACK">动力电池包 (PACK · DMA · 需 pack-manufacturer)</option>
              </select>
            </div>
            <div>
              <label htmlFor="reg-chem" className="mb-1 block font-semibold text-ink-secondary">
                材料体系 (X5)
              </label>
              <select
                id="reg-chem"
                value={regChem}
                onChange={e => {
                  const ch = e.target.value as 'B' | 'E' | 'J';
                  setRegChem(ch);
                  setRegCode(buildStandardCode(regKind, ch, regMfgDate));
                }}
                className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-xs outline-none focus:border-brand"
              >
                <option value="B">B · 磷酸铁锂 (LFP)</option>
                <option value="E">E · 三元材料 (TERNARY)</option>
                <option value="J">J · 钠离子 (修改单)</option>
              </select>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="reg-code" className="font-semibold text-ink-secondary">
                24 位标准编码（X15–X17 自动与制造日期同步）
              </label>
              <button
                type="button"
                onClick={() => setRegCode(buildStandardCode(regKind, regChem, regMfgDate))}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
              >
                <RefreshCw className="h-3 w-3" />
                重新生成流水号
              </button>
            </div>
            <input
              id="reg-code"
              type="text"
              value={regCode}
              onChange={e => setRegCode(e.target.value.toUpperCase())}
              className="mono w-full rounded-lg border border-line bg-white px-3 py-2 font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="reg-mfg-date" className="mb-1 block font-semibold text-ink-secondary">
                制造日期 (manufacturedAt)
              </label>
              <input
                id="reg-mfg-date"
                type="text"
                value={regMfgDate}
                onChange={e => {
                  const nextDate = e.target.value;
                  setRegMfgDate(nextDate);
                  const dc = encodeGbtDate(nextDate);
                  if (dc && regCode.length === 24) {
                    setRegCode(prev => `${prev.slice(0, 14)}${dc}${prev.slice(17)}`);
                  }
                }}
                className="mono w-full rounded-lg border border-line bg-white px-2.5 py-2 outline-none focus:border-brand"
              />
            </div>
            <div>
              <label htmlFor="reg-life" className="mb-1 block font-semibold text-ink-secondary">
                设计寿命 (月)
              </label>
              <input
                id="reg-life"
                type="number"
                value={regLifeMonths}
                onChange={e => setRegLifeMonths(e.target.value)}
                className="mono w-full rounded-lg border border-line bg-white px-2.5 py-2 outline-none focus:border-brand"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={regBusy || identityLoading || switching}
            className="w-full cursor-pointer rounded-lg bg-brand py-2.5 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-50"
          >
            {regBusy ? '链码建档提交中...' : `以 ${actor?.name ?? '当前身份'} 写入 24 位标准电池数字身份`}
          </button>
        </form>
      </div>
  );
}
