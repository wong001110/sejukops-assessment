import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { auditFreshBaseline, REQUIRED_FUNCTIONS, REQUIRED_PRIVATE_TABLES,
  REQUIRED_TABLES, STAFF_READ_ROOTS, PREVIEW_READ_ROOTS } from '../../scripts/p1-audit-fresh-baseline.mjs';
import { normalizeFreshBaseline } from '../../scripts/p1-normalize-fresh-baseline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fixtureSql() {
  return [
    'CREATE SCHEMA private;',
    ...['TABLES', 'SEQUENCES', 'FUNCTIONS'].map(kind =>
      `REVOKE ALL ON ALL ${kind} IN SCHEMA public, private FROM PUBLIC, anon, authenticated;`),
    ...['TABLES', 'SEQUENCES', 'FUNCTIONS'].map(kind =>
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${kind} FROM PUBLIC, anon, authenticated;`),
    ...REQUIRED_TABLES.map(name => `CREATE TABLE public.${name} (id uuid);`),
    ...REQUIRED_PRIVATE_TABLES.map(name => `CREATE TABLE private.${name} (id uuid);`),
    ...REQUIRED_FUNCTIONS.map(name => `CREATE FUNCTION ${name}() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`),
    ...REQUIRED_PRIVATE_TABLES.filter(name => name.startsWith('staff_') || name === 'owner_previews')
      .map(name => `ALTER TABLE private.${name} ENABLE ROW LEVEL SECURITY;`),
    ...STAFF_READ_ROOTS.map(name => `CREATE POLICY ${name}_staff_readiness ON public.${name} AS RESTRICTIVE FOR SELECT TO authenticated USING (true);`),
    ...PREVIEW_READ_ROOTS.map(name => `CREATE POLICY ${name}_owner_preview ON public.${name} AS RESTRICTIVE FOR SELECT TO authenticated USING (true);`),
    ...['app_role', 'platform_role', 'workspace_kind', 'service_order_status']
      .map(name => `CREATE TYPE public.${name} AS ENUM ('TEST');`),
    ...['profiles', 'workspaces', 'workspace_memberships', 'workspace_orders', 'knowledge_documents']
      .map(name => `ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;`),
  ].join('\n');
}

test('current source baseline passes static checks but does not claim live replay', async () => {
  const result = await auditFreshBaseline(root);
  assert.equal(result.staticReady, true);
  assert.ok(result.historicalMigrationCount >= 47);
  assert.equal(result.historicalEmptyReplayBlockedBy, '20260929070000_p6_retire_assessment_database.sql');
  assert.deepEqual(result.blockers, []);
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
    assert.equal(ready.catalogSeedPath, 'supabase/fresh/catalog-seed.sql');
    assert.equal(ready.liveEmptyProjectReplay, 'NOT_RUN');

    await writeFile(file, `${fixtureSql().replace('CREATE TABLE public.guest_visits (id uuid);', '')}\n`
      + 'CREATE TABLE public.orders (id uuid);\n'
      + 'CREATE TABLE private.demo_ai_policy (singleton boolean);\n'
      + 'CREATE FUNCTION public.demo_ai_reserve() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;\n'
      + 'CREATE FUNCTION public.demo_select_persona() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;\n'
      + 'CREATE SCHEMA public;\n\\restrict token\n'
      + 'COPY public.workspace_orders FROM stdin;\n');
    const invalid = await auditFreshBaseline(root, file);
    assert.ok(invalid.blockers.includes('MISSING_TABLE:public.guest_visits'));
    assert.ok(invalid.blockers.includes('LEGACY_TABLE_PRESENT:public.orders'));
    assert.ok(invalid.blockers.includes('LEGACY_TABLE_PRESENT:private.demo_ai_policy'));
    assert.ok(invalid.blockers.includes('LEGACY_FUNCTION_PRESENT:public.demo_ai_reserve'));
    assert.ok(invalid.blockers.includes('LEGACY_FUNCTION_PRESENT:public.demo_select_persona'));
    assert.ok(invalid.blockers.includes('DUMP_COMMAND_REVIEW_REQUIRED'));
    assert.ok(invalid.blockers.includes('POSSIBLE_DATA_STATEMENTS_REVIEW_REQUIRED'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('normalization strips pg_dump-only commands and source-platform default grants', () => {
  const raw = [
    '\\restrict token', 'SET transaction_timeout = 0;',
    'CREATE SCHEMA private;', 'CREATE SCHEMA public;',
    '-- Name: SCHEMA private; Type: ACL;',
    '--', '-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL;', '--',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;',
    '--', '-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL;', '--',
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;',
    '-- PostgreSQL database dump complete', '\\unrestrict token', '',
  ].join('\n');
  const sql = normalizeFreshBaseline(raw);
  assert.equal(normalizeFreshBaseline(raw.replace(/\n/g, '\r\r\n')), sql);
  assert.ok(sql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public, private'));
  assert.ok(sql.includes('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS'));
  assert.ok(!sql.includes('\\restrict') && !sql.includes('\\unrestrict'));
  assert.ok(!sql.includes('CREATE SCHEMA public;'));
  assert.ok(!sql.includes('supabase_admin'));
  assert.ok(!sql.includes('transaction_timeout'));
});

test('fresh baseline audit rejects missing staff state RLS and restrictive read fences', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'sejukops-staff-baseline-'));
  const file = join(temp, 'baseline.sql');
  try {
    const source = fixtureSql().replace('ALTER TABLE private.staff_password_claims ENABLE ROW LEVEL SECURITY;', '')
      .replace('CREATE POLICY workspace_orders_staff_readiness ON public.workspace_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (true);','')
      .replace('CREATE POLICY workspace_customers_owner_preview ON public.workspace_customers AS RESTRICTIVE FOR SELECT TO authenticated USING (true);','');
    await writeFile(file, source);
    const result = await auditFreshBaseline(root, file);
    assert.equal(result.staticReady,false);
    assert.ok(result.blockers.includes('MISSING_RLS:private.staff_password_claims'));
    assert.ok(result.blockers.includes('MISSING_RESTRICTIVE_POLICY:workspace_orders_staff_readiness'));
    assert.ok(result.blockers.includes('MISSING_RESTRICTIVE_POLICY:workspace_customers_owner_preview'));
  } finally { await rm(temp, { recursive:true,force:true }); }
});
