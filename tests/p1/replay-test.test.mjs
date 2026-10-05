import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildTestReplaySql, isTestReplayPostStateReady,
  verifyFreshBackup } from '../../scripts/p1-replay-test.mjs';
import { testDataDigestSql } from '../../scripts/p1-test-data-digest.mjs';

const baseline = readFileSync(new URL('../../supabase/fresh/baseline.sql', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../../supabase/fresh/catalog-seed.sql', import.meta.url), 'utf8');
const digest = 'a'.repeat(32);

test('historical destructive Test replay refuses the expanded staff baseline', () => {
  assert.throws(() => buildTestReplaySql(baseline, catalog, digest),
    /Reviewed application table set changed/);
});

test('Test replay rejects changed schema, catalog and missing backup digest', () => {
  assert.throws(() => buildTestReplaySql(`${baseline}\n-- changed`, catalog, digest), /hash changed/);
  assert.throws(() => buildTestReplaySql(baseline, `${catalog}\n-- changed`, digest),
    /Reviewed application table set changed/);
  assert.throws(() => buildTestReplaySql(baseline, catalog, ''), /digest required/);
  assert.throws(() => verifyFreshBackup({ projectRef: 'ajgznurwvsxfkjvqzhlj' }), /exact-Test backup/);
});

test('historical Test data digest refuses unreviewed expanded table coverage', () => {
  assert.throws(() => testDataDigestSql(baseline), /Reviewed Test application table set changed/);
});

test('post-commit readback rejects weakened permissions or missing identities', () => {
  const good = {
    fingerprint: '0574ac207e44fed88d2c51cc5533d8c8', authUsers: 4,
    readyOwner: 1, fixedDemoUsers: 3, profiles: 4, unlinkedProfiles: 0,
    superAdmins: 1, demoPrincipals: 3, memberships: 4, technicians: 1,
    workspaces: 2, branches: 2, customers: 1, orders: 4, knowledgeDocuments: 2,
    guestVisits: 0, providerConfigs: 0, policies: 12,
    publicOwner: 'pg_database_owner', migrations: 35,
    anonOrdersSelect: false, authenticatedOrdersInsert: false,
    authenticatedOrdersSelect: true, anonDemoSeedExecute: false,
  };
  assert.equal(isTestReplayPostStateReady(good), true);
  assert.equal(isTestReplayPostStateReady({ ...good, readyOwner: 0 }), false);
  assert.equal(isTestReplayPostStateReady({ ...good, anonOrdersSelect: true }), false);
  assert.equal(isTestReplayPostStateReady({ ...good, guestVisits: 1 }), false);
});
