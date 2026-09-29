import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildTestReplaySql, isTestReplayPostStateReady,
  verifyFreshBackup } from '../../scripts/p1-replay-test.mjs';
import { testDataDigestSql } from '../../scripts/p1-test-data-digest.mjs';

const baseline = readFileSync(new URL('../../supabase/fresh/baseline.sql', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../../supabase/fresh/catalog-seed.sql', import.meta.url), 'utf8');
const digest = 'a'.repeat(32);

test('Test replay SQL locks managed identities and all app rows before guarded drop', () => {
  const sql = buildTestReplaySql(baseline, catalog, digest);
  assert.match(sql, /lock table auth\.users, storage\.objects, storage\.buckets,/i);
  assert.match(sql, /lock table public\.workspace_assignment_proposals,.*private\.guest_ai_budget_policy/s);
  assert.match(sql, /TEST_REPLAY_PREFLIGHT_CHANGED/);
  assert.match(sql, new RegExp(digest));
  assert.match(sql, /drop schema private cascade;/);
  assert.doesNotMatch(sql, /drop schema (?:public|auth|storage|extensions|supabase_migrations)/i);
  assert.doesNotMatch(sql, /^SET (?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout) = 0;$/m);
  assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
  assert.match(sql, /insert into public\.profiles/);
  assert.match(sql, /private\.demo_seed\(\)/);
  assert.match(sql, /TEST_REPLAY_POSTCHECK_FAILED/);
});

test('Test replay rejects changed schema, catalog and missing backup digest', () => {
  assert.throws(() => buildTestReplaySql(`${baseline}\n-- changed`, catalog, digest), /hash changed/);
  assert.throws(() => buildTestReplaySql(baseline, `${catalog}\n-- changed`, digest), /Catalog transaction/);
  assert.throws(() => buildTestReplaySql(baseline, catalog, ''), /digest required/);
  assert.throws(() => verifyFreshBackup({ projectRef: 'ajgznurwvsxfkjvqzhlj' }), /exact-Test backup/);
});

test('data digest covers every reviewed app table and Auth identity fields', () => {
  const sql = testDataDigestSql(baseline);
  assert.equal((sql.match(/md5\(to_jsonb\(t\)::text\)/g) ?? []).length, 24);
  assert.match(sql, /from public\.workspace_orders t/);
  assert.match(sql, /from private\.guest_ai_budget_policy t/);
  assert.match(sql, /u\.encrypted_password/);
  assert.match(sql, /order by source,row_hash/);
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
