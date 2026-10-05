// Read-only preflight for an application replay on the confirmed Test project.
// node scripts/p1-inspect-test-replay.mjs --project-ref qobhjvrrpajoyvlgrkbx
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { REVIEWED_BASELINE_SHA256 } from './p1-apply-fresh-baseline.mjs';
import { normalizeFreshBaseline } from './p1-normalize-fresh-baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_REF = 'qobhjvrrpajoyvlgrkbx';
// Independently matched against the Test catalog on 2026-09-29. This covers
// object names/signatures, not their bodies, grants, policies, or table columns.
const REVIEWED_OBJECT_NAME_FINGERPRINT = '0574ac207e44fed88d2c51cc5533d8c8';

export function parseTestTarget(args, environment) {
  if (args.length !== 2 || args[0] !== '--project-ref' || args[1] !== TEST_REF) {
    throw new Error('Test replay inventory requires the exact confirmed project ref');
  }
  let url;
  try { url = new URL(environment.NEXT_PUBLIC_SUPABASE_URL); } catch { /* fail closed below */ }
  if (url?.href !== `https://${TEST_REF}.supabase.co/`
    || typeof environment.SUPABASE_DB_PASSWORD !== 'string'
    || !environment.SUPABASE_DB_PASSWORD) {
    throw new Error('Test replay inventory requires matching local Test credentials');
  }
  return { host: `db.${TEST_REF}.supabase.co`, password: environment.SUPABASE_DB_PASSWORD };
}

export function testInventorySql() {
  return `with app_objects as (
  select 'relation' as kind, n.nspname as schema_name, c.relname as identity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
  union all
  select 'routine', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
  union all
  select 'enum', n.nspname, t.typname
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public','private') and t.typtype = 'e'
)
select json_build_object(
  'objectNameFingerprint', (select md5(string_agg(kind || ':' || schema_name || '.' || identity, E'\\n'
    order by kind, schema_name, identity)) from app_objects),
  'publicRelations', (select count(*) from app_objects where kind = 'relation' and schema_name = 'public'),
  'privateRelations', (select count(*) from app_objects where kind = 'relation' and schema_name = 'private'),
  'publicRoutines', (select count(*) from app_objects where kind = 'routine' and schema_name = 'public'),
  'privateRoutines', (select count(*) from app_objects where kind = 'routine' and schema_name = 'private'),
  'enums', (select count(*) from app_objects where kind = 'enum'),
  'policies', (select count(*) from pg_policies where schemaname in ('public','private')),
  'publicSchemaOwner', (select nspowner::regrole::text from pg_namespace where nspname = 'public'),
  'extensionOwnedRelations', (select count(*) from pg_depend d
    join pg_extension e on e.oid = d.refobjid
    join pg_class c on c.oid = d.objid
    join pg_namespace n on n.oid = c.relnamespace
    where d.deptype = 'e' and n.nspname in ('public','private')),
  'externalForeignKeys', (select count(*) from pg_constraint co
    join pg_class source on source.oid = co.conrelid
    join pg_namespace sn on sn.oid = source.relnamespace
    join pg_class target on target.oid = co.confrelid
    join pg_namespace tn on tn.oid = target.relnamespace
    where co.contype = 'f' and sn.nspname not in ('public','private')
      and tn.nspname in ('public','private')),
  'publicationTables', (select count(*) from pg_publication_tables
    where schemaname in ('public','private')),
  'ownerAuthUsers', (select count(*) from auth.users
    where lower(email) = 'sejukops@superadmin.com'),
  'readyOwnerAuthUsers', (select count(*) from auth.users
    where lower(email) = 'sejukops@superadmin.com'
      and encrypted_password is not null and email_confirmed_at is not null),
  'fixedDemoAuthUsers', (select count(*) from auth.users
    where lower(email) in ('guest-admin@sejukops.example',
      'guest-manager@sejukops.example', 'guest-technician@sejukops.example')),
  'otherAuthUsers', (select count(*) from auth.users
    where email is null or lower(email) not in ('sejukops@superadmin.com',
      'guest-admin@sejukops.example', 'guest-manager@sejukops.example',
      'guest-technician@sejukops.example')),
  'authSessions', (select count(*) from auth.sessions),
  'refreshTokens', (select count(*) from auth.refresh_tokens),
  'profiles', (select count(*) from public.profiles),
  'unlinkedProfiles', (select count(*) from public.profiles where auth_user_id is null),
  'memberships', (select count(*) from public.workspace_memberships),
  'workspaces', (select count(*) from public.workspaces),
  'orders', (select count(*) from public.workspace_orders),
  'knowledgeDocuments', (select count(*) from public.knowledge_documents),
  'guestVisits', (select count(*) from public.guest_visits),
  'providerConfigs', (select count(*) from public.ai_provider_configs),
  'auditLogs', (select count(*) from public.audit_logs),
  'storageObjects', (select count(*) from storage.objects),
  'storageBuckets', (select count(*) from storage.buckets),
  'appliedMigrations', (select count(*) from supabase_migrations.schema_migrations),
  'latestMigration', (select max(version) from supabase_migrations.schema_migrations)
)::text;
`;
}

export function assessTestInventory(inventory, expectedFingerprint) {
  const exact = {
    objectNameFingerprint: expectedFingerprint,
    publicRelations: 18, privateRelations: 6,
    publicRoutines: 37, privateRoutines: 45, enums: 12, policies: 12,
    publicSchemaOwner: 'pg_database_owner',
    extensionOwnedRelations: 0, externalForeignKeys: 0, publicationTables: 0,
    ownerAuthUsers: 1, readyOwnerAuthUsers: 1, fixedDemoAuthUsers: 3,
    otherAuthUsers: 0, workspaces: 2, storageObjects: 0, storageBuckets: 0,
    appliedMigrations: 35, latestMigration: '20260929083803',
    schemaMatchesBaseline: true,
  };
  return Object.entries(exact)
    .filter(([field, value]) => inventory[field] !== value)
    .map(([field]) => field);
}

function psqlExecutable() {
  const windowsPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
  return process.platform === 'win32' && existsSync(windowsPath) ? windowsPath : 'psql';
}

function pgDumpExecutable() {
  const windowsPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe';
  return process.platform === 'win32' && existsSync(windowsPath) ? windowsPath : 'pg_dump';
}

function main() {
  const environment = parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'));
  const target = parseTestTarget(process.argv.slice(2), environment);
  const result = spawnSync(psqlExecutable(), [
    '--no-psqlrc', '--no-password', '--tuples-only', '--no-align',
    '-v', 'ON_ERROR_STOP=1', '-h', target.host, '-U', 'postgres', '-d', 'postgres',
    '-c', testInventorySql(),
  ], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 100_000, windowsHide: true,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on' },
  });
  if (result.error || result.status !== 0) throw new Error('Read-only Test inventory failed');
  const inventory = JSON.parse(result.stdout.trim());
  const dump = spawnSync(pgDumpExecutable(), [
    '--no-password', '--schema-only', '--schema=public', '--schema=private',
    '--no-owner', '--no-comments', '-h', target.host, '-U', 'postgres', '-d', 'postgres',
  ], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4_000_000, windowsHide: true,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10' },
  });
  if (dump.error || dump.status !== 0) throw new Error('Read-only Test schema export failed');
  const normalized = normalizeFreshBaseline(dump.stdout);
  inventory.schemaSha256 = createHash('sha256').update(normalized).digest('hex').toUpperCase();
  inventory.schemaMatchesBaseline = inventory.schemaSha256 === REVIEWED_BASELINE_SHA256;
  const differences = assessTestInventory(inventory, REVIEWED_OBJECT_NAME_FINGERPRINT);
  console.log(JSON.stringify({ projectRef: TEST_REF, inventory, differences, ready: differences.length === 0 }, null, 2));
  if (differences.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Read-only Test inventory failed');
    process.exitCode = 1;
  }
}
