import test from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorCode } from './transactions.js';

test('standard code rejections remain business errors through Fabric details', () => {
  for (const code of ['CODE_CHEMISTRY', 'CODE_DATE', 'CODE_DATE_MISMATCH', 'CODE_SERIAL']) {
    assert.equal(safeErrorCode({ message: 'endorsement failed', details: [{ message: `${code}: validation rejected` }] }), code);
  }
  assert.equal(safeErrorCode(new Error('transport down')), 'DEPENDENCY_UNAVAILABLE');
});
