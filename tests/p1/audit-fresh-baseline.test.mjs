import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { auditFreshBaseline, REQUIRED_FUNCTIONS, REQUIRED_PRIVATE_TABLES,
  REQUIRED_TABLES } from '../../scripts/p1-audit-fresh-baseline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fixtureSql() {
  return [
    'CREATE SCHEMA private;',
    ...REQUIRED_TABLES.map(name => `CREATE TABLE public.${name} (id uuid);`),
    ...REQUIRED_PRIVATE_TABLES.map(name => `CREATE TABLE private.${name} (id uuid);`),
    ...REQUIRED_FUNCTIONS.map(name => `CREATE FUNCTION ${name}() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`),
    ...['app_role', 'platform_role', 'workspace_kind', 'service_order_status']
      .map(name => `CREATE TYPE public.${name} AS ENUM ('TEST');`),
    ...['profiles', 'workspaces', 'workspace_memberships', 'workspace_orders', 'knowledge_documents']
      .map(name => `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;`),
  ].join('\n');
}

test('current history flags the missing independent schema-only baseline', async () => {
  const result = await auditFreshBaseline(root);
  assert.equal(result.staticReady, false);
  assert.ok(result.historicalMigrationCount >= 47);
  assert.equal(result.historicalEmptyReplayBlockedBy, '20260929070000_p6_retire_assessment_database.sql');
  assert.ok(result.blockers.includes('SCHEMA_ONLY_BASELINE_MISSING'));
  assert.equal(result.liveEmptyProjectReplay, 'NOT_RUN');
});

test('static baseline audit detects missing current objects, legacy tables, and data statements', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'sejukops-baseline-'));
  const file = join(temp, 'baseline.sql');
  try {
    await writeFile(file, fixtureSql().replace('SELECT true $$;', () =>
      'INSERT INTO public.workspace_orders VALUES (gen_random_uuid()); SELECT true $$;'));
    const ready = await auditFreshBaseline(root, file);
    assert.deepEqual(ready.blockers, []);
    assert.equal(ready.staticReady, true);
    assert.equal(ready.liveEmptyProjectReplay, 'NOT_RUN');

    await writeFile(file, `${fixtureSql().replace('CREATE TABLE public.guest_visits (id uuid);', '')}\n`
      + 'CREATE TABLE public.orders (id uuid);\nCOPY public.workspace_orders FROM stdin;\n');
    const invalid = await auditFreshBaseline(root, file);
    assert.ok(invalid.blockers.includes('MISSING_TABLE:public.guest_visits'));
    assert.ok(invalid.blockers.includes('LEGACY_TABLE_PRESENT:public.orders'));
    assert.ok(invalid.blockers.includes('POSSIBLE_DATA_STATEMENTS_REVIEW_REQUIRED'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
