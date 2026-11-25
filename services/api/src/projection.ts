import type { Asset } from './types.js';

export function serviceAge(firstUseAt: string | null, asOf: Date): { years: number; months: number; days: number } | null {
  if (firstUseAt === null) return null;
  const first = new Date(firstUseAt);
  if (!Number.isFinite(first.valueOf()) || !Number.isFinite(asOf.valueOf()) || first > asOf) return null;
  // Calendar units in Asia/Shanghai. Clamp month-end anniversaries instead of overflowing dates.
  const offset = 8 * 60 * 60 * 1000;
  const start = new Date(first.valueOf() + offset);
  const end = new Date(asOf.valueOf() + offset);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const anniversary = (count: number) => {
    const month = start.getUTCMonth() + count;
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(start.getUTCFullYear(), month, Math.min(start.getUTCDate(), lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
  };
  if (anniversary(months) > end) months--;
  const days = Math.floor((end.valueOf() - anniversary(months).valueOf()) / 86_400_000);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

export function projectBattery(asset: Asset, now = new Date()) {
  const states: Record<string, string> = {
    REGISTERED: asset.parentId ? '已装配' : '未装配', ASSEMBLED: '已装配未装车',
    RELEASED: '已装配未装车', INSTALLED: '已装车未投入使用', IN_USE: '使用中',
    RETIRED: '已退役', RECEIVED_FOR_RECYCLING: '已交回收企业',
    PROCESSED: asset.scrappedAt ? '已报废' : asset.echelonCode ? '已转梯次利用（保留原码关联）' : '已处理，报废待核验',
  };
  return {
    ...asset, statusLabel: states[asset.state] ?? '状态待核验',
    serviceAge: serviceAge(asset.firstUseAt, now),
    health: { sohPct: null, cycleCount: null, remainingLifeEstimate: null, plannedScrapAt: null },
    scrapped: asset.scrappedAt !== null,
    evidence: { txId: asset.txId, updatedAt: asset.updatedAt, simulation: asset.simulation, source: 'FABRIC_COMMITTED_STATE' },
    asOf: now.toISOString(),
  };
}
