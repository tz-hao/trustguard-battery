import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceAge, projectBattery } from './projection.js';
import type { Asset } from './types.js';

test('service age uses actual first use and calendar anniversaries', () => {
  assert.deepEqual(serviceAge('2024-07-01T00:00:00Z', new Date('2026-11-15T00:00:00Z')), { years: 2, months: 4, days: 14 });
  assert.equal(serviceAge(null, new Date()), null);
  assert.equal(serviceAge('2027-01-01T00:00:00Z', new Date('2026-11-15T00:00:00Z')), null);
  assert.deepEqual(serviceAge('2024-01-31T00:00:00Z', new Date('2024-02-29T00:00:00Z')), { years: 0, months: 1, days: 0 });
  assert.deepEqual(serviceAge('2024-02-29T00:00:00Z', new Date('2025-02-28T00:00:00Z')), { years: 1, months: 0, days: 0 });
});
test('processed does not invent scrap evidence or remaining life', () => {
  const asset = { state: 'PROCESSED', scrappedAt: null, firstUseAt: null, simulation: true, txId: 'tx', updatedAt: '2026-11-15T00:00:00Z' } as Asset;
  const result = projectBattery(asset);
  assert.equal(result.scrapped, false);
  assert.equal(result.serviceAge, null);
  assert.equal(result.health.remainingLifeEstimate, null);
  assert.equal(result.statusLabel, '已处理，报废待核验');
});
