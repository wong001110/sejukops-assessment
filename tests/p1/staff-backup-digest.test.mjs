import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { staffBackupDataDigestSql, testDataDigestSql } from '../../scripts/p1-test-data-digest.mjs';

const baseline = readFileSync(new URL('../../supabase/fresh/baseline.sql', import.meta.url), 'utf8');

test('staff backup covers every reviewed table and Auth without returning raw credential rows', () => {
  const sql = staffBackupDataDigestSql(baseline);
  for (const table of ['staff_accounts', 'staff_provisioning', 'staff_imports', 'staff_import_rows',
    'staff_password_claims', 'staff_password_resets', 'owner_previews']) {
    assert.ok(sql.includes(`from private.${table} t`));
  }
  assert.ok(sql.includes('from auth.users u'));
  assert.match(sql, /select md5\(coalesce\(string_agg/);
});

test('an omitted or substituted staff table cannot produce an incomplete safety digest', () => {
  assert.throws(() => staffBackupDataDigestSql(baseline.replace('CREATE TABLE private.staff_accounts (', '-- omitted (')),
    /table set changed/);
  assert.throws(() => staffBackupDataDigestSql(baseline.replace('CREATE TABLE private.staff_accounts (', 'CREATE TABLE private.unreviewed_accounts (')),
    /table set changed/);
});

test('historical destructive replay digest stays incompatible with the staff schema', () => {
  assert.throws(() => testDataDigestSql(baseline), /table set changed/);
});
