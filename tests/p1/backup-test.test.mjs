import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyArchiveList } from '../../scripts/p1-backup-test.mjs';

const applicationList = [
  '123; 0 1 TABLE DATA public profiles postgres',
  '124; 0 2 TABLE DATA public workspace_orders postgres',
  '125; 0 3 TABLE DATA private guest_ai_budget_policy postgres',
].join('\n');

test('rollback archive check requires actual application table data', () => {
  assert.equal(verifyArchiveList(applicationList, 'application'), 3);
  assert.throws(() => verifyArchiveList(applicationList.replace('workspace_orders', 'other'), 'application'),
    /missing required table data/);
});

test('full archive check requires managed Auth data as well as application data', () => {
  assert.throws(() => verifyArchiveList(applicationList, 'full'), /missing required table data/);
  assert.equal(verifyArchiveList(`${applicationList}\n126; 0 4 TABLE DATA auth users supabase_auth_admin`, 'full'), 4);
});
