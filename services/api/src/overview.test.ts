import test from 'node:test';
import assert from 'node:assert/strict';
import { isActivePendingRelease, isActivePendingTransfer } from './overview.js';

test('dashboard pendingReleases excludes completed and expired releases or expired risk attestations', () => {
  const now = Date.parse('2026-11-25T10:00:00Z');
  assert.equal(
    isActivePendingRelease(
      { state: 'PENDING', expiresAt: '2026-11-25T10:10:00Z', risk: { expiresAt: '2026-11-25T10:05:00Z' } },
      now,
    ),
    true,
  );
  assert.equal(
    isActivePendingRelease(
      { state: 'PENDING', expiresAt: '2026-11-25T09:59:00Z', risk: { expiresAt: '2026-11-25T10:05:00Z' } },
      now,
    ),
    false,
  );
  assert.equal(
    isActivePendingRelease(
      { state: 'PENDING', expiresAt: '2026-11-25T10:10:00Z', risk: { expiresAt: '2026-11-25T09:55:00Z' } },
      now,
    ),
    false,
  );
  assert.equal(
    isActivePendingRelease(
      { state: 'COMPLETED', expiresAt: '2026-11-25T10:10:00Z', risk: { expiresAt: '2026-11-25T10:05:00Z' } },
      now,
    ),
    false,
  );
});

test('dashboard pendingTransfers excludes terminal and expired transfers', () => {
  const now = Date.parse('2026-11-25T10:00:00Z');
  assert.equal(isActivePendingTransfer({ state: 'SENT', expiresAt: '2026-11-25T10:30:00Z' }, now), true);
  assert.equal(isActivePendingTransfer({ state: 'SENT', expiresAt: '2026-11-25T09:59:00Z' }, now), false);
  assert.equal(isActivePendingTransfer({ state: 'COMMITTED', expiresAt: '2026-11-25T10:30:00Z' }, now), false);
  assert.equal(isActivePendingTransfer({ state: 'CANCELLED', expiresAt: '2026-11-25T10:30:00Z' }, now), false);
});
