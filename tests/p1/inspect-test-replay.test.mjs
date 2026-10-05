import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assessTestInventory, parseTestTarget, testInventorySql } from '../../scripts/p1-inspect-test-replay.mjs';

const ref = 'qobhjvrrpajoyvlgrkbx';
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_DB_PASSWORD: 'fixture-only',
};

test('read-only Test inventory rejects another project, wrong URL, and missing DB password', () => {
  assert.equal(parseTestTarget(['--project-ref', ref], environment).host, `db.${ref}.supabase.co`);
  assert.throws(() => parseTestTarget(['--project-ref', 'ajgznurwvsxfkjvqzhlj'], environment), /exact confirmed/);
  assert.throws(() => parseTestTarget(['--project-ref', ref], {
    ...environment, NEXT_PUBLIC_SUPABASE_URL: 'https://ajgznurwvsxfkjvqzhlj.supabase.co',
  }), /matching local Test/);
  assert.throws(() => parseTestTarget(['--project-ref', ref], {
    ...environment, SUPABASE_DB_PASSWORD: '',
  }), /matching local Test/);
});

test('inventory query is read-only and review gate detects identity and catalog drift', () => {
  const sql = testInventorySql();
  assert.match(sql, /from auth\.users/);
  assert.match(sql, /from storage\.objects/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate)\s+/i);
  const expected = 'fixture-fingerprint';
  const inventory = {
    objectNameFingerprint: expected,
    publicRelations: 18, privateRelations: 6,
    publicRoutines: 37, privateRoutines: 45, enums: 12, policies: 12,
    publicSchemaOwner: 'pg_database_owner',
    extensionOwnedRelations: 0, externalForeignKeys: 0, publicationTables: 0,
    ownerAuthUsers: 1, readyOwnerAuthUsers: 1, fixedDemoAuthUsers: 3,
    otherAuthUsers: 0, workspaces: 2, storageObjects: 0, storageBuckets: 0,
    appliedMigrations: 35, latestMigration: '20260929083803',
    schemaMatchesBaseline: true,
  };
  assert.deepEqual(assessTestInventory(inventory, expected), []);
  assert.deepEqual(assessTestInventory({
    ...inventory, otherAuthUsers: 1, externalForeignKeys: 1, publicRoutines: 38,
    schemaMatchesBaseline: false,
  }, expected), ['publicRoutines', 'externalForeignKeys', 'otherAuthUsers', 'schemaMatchesBaseline']);
});
