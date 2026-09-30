import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assertCurrentTestSnapshot, buildHostedRestoreRehearsalSql }
  from '../../scripts/p1-rehearse-hosted-restore.mjs';

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
const report = { dataDigest: 'a'.repeat(32), authDigest: 'b'.repeat(32) };

test('hosted Test rehearsal restores only application schemas and always rolls back', () => {
  const sql = buildHostedRestoreRehearsalSql(baseline,
    `${archiveHeader}${managedDefaultGrants}\n`, report);
  assert.match(sql, /TEST_HOSTED_REHEARSAL_PREFLIGHT_CHANGED/);
  assert.match(sql, /TEST_HOSTED_REHEARSAL_RESTORE_FAILED/);
  assert.match(sql, /lock table auth\.users, storage\.objects/);
  assert.match(sql, /drop schema private cascade;/);
  assert.doesNotMatch(sql, /drop schema (?:public|auth|storage|extensions)/i);
  assert.match(sql, /pg_constraint.*co\.convalidated/s);
  assert.match(sql, /has_table_privilege\('anon','public\.workspace_orders','SELECT'\)/);
  assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^rollback;$/gm) ?? []).length, 1);
  assert.doesNotMatch(sql, /^commit;$/gm);
});

test('hosted rehearsal rejects changed reviewed source and mismatched backup identity', () => {
  assert.throws(() => buildHostedRestoreRehearsalSql(`${baseline}\n-- changed`, archiveHeader, report),
    /baseline or backup digest changed/);
  assert.throws(() => buildHostedRestoreRehearsalSql(baseline, archiveHeader,
    { ...report, authDigest: 'bad' }), /baseline or backup digest changed/);
  assert.throws(() => buildHostedRestoreRehearsalSql(baseline, archiveHeader, report),
    /default privilege statements changed/);
  const stamp = '2026-09-29T12-31-32-733Z-05aa64fd';
  const snapshot = {
    projectRef: 'qobhjvrrpajoyvlgrkbx', sourceHost: 'db.qobhjvrrpajoyvlgrkbx.supabase.co',
    manifestName: `test-backup-${stamp}.json`, createdAt: '2026-09-29T12:31:32.733Z',
    archives: [{ file: `test-full-${stamp}.dump` },
      { file: `test-application-${stamp}.dump` }],
  };
  const now = Date.parse('2026-09-29T12:45:00Z');
  assert.doesNotThrow(() => assertCurrentTestSnapshot(snapshot, snapshot.sourceHost, now));
  assert.throws(() => assertCurrentTestSnapshot(snapshot, snapshot.sourceHost, now + 31 * 60_000),
    /fresh backup/);
  assert.throws(() => assertCurrentTestSnapshot(snapshot, 'db.other.supabase.co', now),
    /fresh backup/);
  assert.throws(() => assertCurrentTestSnapshot({ ...snapshot,
    archives: [{ file: 'test-full-other.dump' }, snapshot.archives[1]] },
  snapshot.sourceHost, now), /identities differ/);
});
