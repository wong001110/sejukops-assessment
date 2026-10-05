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
const managedDefaultGrants = ['SEQUENCES', 'FUNCTIONS', 'TABLES'].flatMap(kind =>
  ['postgres', 'anon', 'authenticated', 'service_role'].map(role =>
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON ${kind} TO ${role};`)).join('\n');

test('rollback preserves managed public schema and bounded transaction timeouts', () => {
  const normalized = normalizeTestArchiveSql(archiveHeader);
  assert.doesNotMatch(normalized, /^CREATE SCHEMA public;$/m);
  assert.match(normalized, /^CREATE SCHEMA private;$/m);
  assert.match(normalized, /SET LOCAL statement_timeout = '120s'/);
  assert.match(normalized, /SET LOCAL transaction_timeout = '120s'/);
  const withDefaults = normalizeTestArchiveSql(`${archiveHeader}${managedDefaultGrants}\n`);
  assert.doesNotMatch(withDefaults, /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/m);
  assert.equal((withDefaults.match(/Preserve managed public default privileges/g) ?? []).length, 12);
  assert.doesNotThrow(() => normalizeTestArchiveSql(
    `${archiveHeader}${managedDefaultGrants.replaceAll('\n', '\r\n')}\r\n`,
    { requireManagedDefaults: true }));
});

test('historical Test rollback refuses the expanded staff baseline', () => {
  assert.throws(() => buildTestRestoreSql(baseline,archiveHeader,
    {dataDigest:'a'.repeat(32),authDigest:'b'.repeat(32)}), /Reviewed private table set changed/);
});

test('rollback rejects malformed archive and out-of-directory manifest paths', () => {
  assert.throws(() => normalizeTestArchiveSql('CREATE SCHEMA private;'), /shape changed/);
  assert.throws(() => normalizeTestArchiveSql(`${archiveHeader}DROP SCHEMA public;`), /shape changed/);
  assert.throws(() => normalizeTestArchiveSql(`${archiveHeader}${managedDefaultGrants.split('\n')[0]}\n`),
    /default privilege statements changed/);
  assert.throws(() => normalizeTestArchiveSql(archiveHeader, { requireManagedDefaults: true }),
    /default privilege statements changed/);
  assert.throws(() => loadExactTestBackup('../other.json'), /manifest name required/);
  assert.throws(() => buildTestRestoreSql(baseline,archiveHeader,
    {dataDigest:'a'.repeat(32),authDigest:'x'}), /digest changed/);
});
