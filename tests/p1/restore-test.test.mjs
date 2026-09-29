import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildTestRestoreSql, loadExactTestBackup,
  normalizeTestArchiveSql } from '../../scripts/p1-restore-test.mjs';

const baseline = readFileSync(new URL('../../supabase/fresh/baseline.sql', import.meta.url), 'utf8');
const archiveHeader = `SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
CREATE SCHEMA private;
CREATE SCHEMA public;
`;

test('rollback preserves managed public schema and bounded transaction timeouts', () => {
  const normalized = normalizeTestArchiveSql(archiveHeader);
  assert.doesNotMatch(normalized, /^CREATE SCHEMA public;$/m);
  assert.match(normalized, /^CREATE SCHEMA private;$/m);
  assert.match(normalized, /SET LOCAL statement_timeout = '120s'/);
  assert.match(normalized, /SET LOCAL transaction_timeout = '120s'/);
  const sql = buildTestRestoreSql(baseline,archiveHeader,
    {dataDigest:'a'.repeat(32),authDigest:'b'.repeat(32)});
  assert.match(sql, /lock table auth\.users, storage\.objects/);
  assert.match(sql, /TEST_ROLLBACK_PREFLIGHT_CHANGED/);
  assert.match(sql, /TEST_ROLLBACK_POSTCHECK_FAILED/);
  assert.match(sql, /drop schema private cascade;/);
  assert.doesNotMatch(sql, /drop schema (?:public|auth|storage|extensions)/i);
  assert.equal((sql.match(/^commit;$/gm) ?? []).length,1);
});

test('rollback rejects malformed archive and out-of-directory manifest paths', () => {
  assert.throws(() => normalizeTestArchiveSql('CREATE SCHEMA private;'), /shape changed/);
  assert.throws(() => normalizeTestArchiveSql(`${archiveHeader}DROP SCHEMA public;`), /shape changed/);
  assert.throws(() => loadExactTestBackup('../other.json'), /manifest name required/);
  assert.throws(() => buildTestRestoreSql(baseline,archiveHeader,
    {dataDigest:'a'.repeat(32),authDigest:'x'}), /digest changed/);
});
