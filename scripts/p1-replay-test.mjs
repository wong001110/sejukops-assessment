// Rebuild only the Sejuk Ops application schemas on the confirmed Test project.
// All SQL changes, including identity reattachment and Demo seeding, commit once.
// node scripts/p1-replay-test.mjs --project-ref qobhjvrrpajoyvlgrkbx --dry-run
// node scripts/p1-replay-test.mjs --project-ref qobhjvrrpajoyvlgrkbx --allow-live
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { auditFreshBaseline } from './p1-audit-fresh-baseline.mjs';
import { REVIEWED_BASELINE_SHA256 } from './p1-apply-fresh-baseline.mjs';
import { parseTestTarget } from './p1-inspect-test-replay.mjs';
import { testDataDigestSql } from './p1-test-data-digest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_REF = 'qobhjvrrpajoyvlgrkbx';
const EXPECTED_FINGERPRINT = '0574ac207e44fed88d2c51cc5533d8c8';
const REVIEWED_CATALOG_SHA256 = '2AE4FA8590403E159A2C9319865E074DC3F7192143DC037C7A6231ECD34C7890';
const BACKUP_DIR = resolve(ROOT, 'supabase/.temp/backups');

function executable(name) {
  const windowsPath = `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`;
  return process.platform === 'win32' && existsSync(windowsPath) ? windowsPath : name;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 4_000_000,
    windowsHide: true, ...options,
  });
  if (result.error || result.status !== 0) {
    // Do not relay provider or database error bodies; they may include private data.
    throw new Error(`${program.split(/[\\/]/).at(-1)} failed`);
  }
  return result.stdout;
}

function catalogBody(seed) {
  if (createHash('sha256').update(seed).digest('hex').toUpperCase() !== REVIEWED_CATALOG_SHA256
    || (seed.match(/^begin;\s*$/gim) ?? []).length !== 1
    || (seed.match(/^commit;\s*$/gim) ?? []).length !== 1
    || seed.search(/^begin;\s*$/im) >= seed.search(/^commit;\s*$/im)) {
    throw new Error('Catalog transaction shape changed; review required');
  }
  return seed.replace(/^begin;\s*$/im, '').replace(/^commit;\s*$/im, '');
}

export function reviewedPublicTableNames(baseline) {
  const names = [...baseline.matchAll(/^CREATE TABLE public\.([a-z_][a-z_0-9]*)\s*\(/gm)]
    .map(match => match[1]);
  if (names.length !== 18 || new Set(names).size !== 18) {
    throw new Error('Reviewed public table set changed');
  }
  return names;
}

export function testApplicationDropSql(baseline) {
  const dropTables = reviewedPublicTableNames(baseline)
    .map(name => `public.${name}`).join(', ');
  return `-- Never remove managed public/auth/storage/extensions schemas or Auth users.
do $drop$ declare r record; begin
  for r in select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
  loop execute format('drop function if exists %I.%I(%s) cascade',r.nspname,r.proname,r.args); end loop;
end $drop$;
drop table ${dropTables} cascade;
drop schema private cascade;
do $types$ declare r record; begin
  for r in select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typtype='e'
  loop execute format('drop type if exists public.%I cascade',r.typname); end loop;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v','m','S'))
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public')
    or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typtype='e')
  then raise exception 'TEST_REPLAY_OBJECT_DROP_INCOMPLETE'; end if;
end $types$;`;
}

export function fingerprintSql() {
  return `(with app_objects as (
    select 'relation' as kind, n.nspname as schema_name, c.relname as identity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
    union all
    select 'routine', n.nspname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
    union all
    select 'enum', n.nspname, t.typname
    from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname in ('public','private') and t.typtype='e'
  ) select md5(string_agg(kind || ':' || schema_name || '.' || identity, E'\\n'
    order by kind,schema_name,identity)) from app_objects)`;
}

export function externalDependentsSql() {
  return `(with app as (
    select 'pg_class'::regclass as classid,c.oid as objid
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private')
    union all select 'pg_proc'::regclass,p.oid
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private')
    union all select 'pg_type'::regclass,t.oid
      from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname in ('public','private')
    union all select 'pg_namespace'::regclass,n.oid
      from pg_namespace n where n.nspname='private'
  ), deps as (
    select d.*,(pg_identify_object(d.classid,d.objid,d.objsubid)).schema as dep_schema
    from pg_depend d join app a on a.classid=d.refclassid and a.objid=d.refobjid
    where d.deptype in ('n','a','i')
  ) select count(*) from deps d
    where not (d.dep_schema in ('public','private')
      or (d.dep_schema='pg_toast' and d.deptype='i')
      or (d.classid='pg_attrdef'::regclass and exists
        (select 1 from pg_attrdef x join app a on a.classid='pg_class'::regclass
          and a.objid=x.adrelid where x.oid=d.objid))
      or (d.classid='pg_policy'::regclass and exists
        (select 1 from pg_policy x join app a on a.classid='pg_class'::regclass
          and a.objid=x.polrelid where x.oid=d.objid))
      or (d.classid='pg_trigger'::regclass and exists
        (select 1 from pg_trigger x join app a on a.classid='pg_class'::regclass
          and a.objid=x.tgrelid where x.oid=d.objid))
      or (d.classid='pg_constraint'::regclass and exists
        (select 1 from pg_constraint x join app a on a.classid='pg_class'::regclass
          and a.objid=x.conrelid where x.oid=d.objid))
      or (d.classid='pg_rewrite'::regclass and exists
        (select 1 from pg_rewrite x join app a on a.classid='pg_class'::regclass
          and a.objid=x.ev_class where x.oid=d.objid))
    ))`;
}

export function buildTestReplaySql(baseline, catalog, expectedDataDigest) {
  const hash = createHash('sha256').update(baseline).digest('hex').toUpperCase();
  if (hash !== REVIEWED_BASELINE_SHA256) throw new Error('Reviewed baseline hash changed');
  if (!/^[0-9a-f]{32}$/.test(expectedDataDigest ?? '')) {
    throw new Error('Exact backup-time Test data digest required');
  }
  const publicTables = reviewedPublicTableNames(baseline);
  const lockTables = [...publicTables.map(name => `public.${name}`),
    ...[...baseline.matchAll(/^CREATE TABLE private\.([a-z_][a-z_0-9]*)\s*\(/gm)]
      .map(match => `private.${match[1]}`)];
  if (lockTables.length !== 24 || new Set(lockTables).size !== 24) {
    throw new Error('Reviewed application table set changed');
  }
  const dataDigest = testDataDigestSql(baseline).replace(/;\s*$/, '');
  const boundedBaseline = baseline
    .replace(/^SET statement_timeout = 0;$/m, "SET LOCAL statement_timeout = '120s';")
    .replace(/^SET lock_timeout = 0;$/m, "SET LOCAL lock_timeout = '5s';")
    .replace(/^SET idle_in_transaction_session_timeout = 0;$/m,
      "SET LOCAL idle_in_transaction_session_timeout = '120s';");
  if (boundedBaseline === baseline || /^(?:SET statement_timeout|SET lock_timeout|SET idle_in_transaction_session_timeout) = 0;$/m.test(boundedBaseline)) {
    throw new Error('Reviewed baseline timeout statements changed');
  }
  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local time zone 'UTC';
set local client_min_messages = warning;
lock table auth.users, storage.objects, storage.buckets,
  supabase_migrations.schema_migrations in share mode;
lock table ${lockTables.join(', ')} in access exclusive mode;
do $guard$ begin
  if current_database() <> 'postgres' or current_user <> 'postgres'
    or current_setting('server_version_num')::int not between 170000 and 179999
    or (select nspowner::regrole::text from pg_namespace where nspname='public') <> 'pg_database_owner'
    or to_regnamespace('auth') is null or to_regnamespace('storage') is null
    or to_regnamespace('extensions') is null or to_regnamespace('private') is null
    or ${fingerprintSql()} <> '${EXPECTED_FINGERPRINT}'
    or (select count(*) from auth.users) <> 4
    or (select count(*) from auth.users where is_anonymous) <> 0
    or (select count(*) from auth.users where lower(email) in
      ('sejukops@superadmin.com','guest-admin@sejukops.example',
       'guest-manager@sejukops.example','guest-technician@sejukops.example')) <> 4
    or (select count(*) from auth.users where lower(email)='sejukops@superadmin.com'
      and encrypted_password is not null and email_confirmed_at is not null) <> 1
    or (select count(*) from public.profiles) <> 10
    or (select count(*) from public.profiles where auth_user_id is null) <> 6
    or (select count(*) from public.workspace_memberships) <> 4
    or (select count(*) from public.workspace_orders) <> 4
    or (select count(*) from public.knowledge_documents) <> 2
    or (select count(*) from public.ai_provider_configs) <> 1
    or (select count(*) from public.audit_logs) <> 33
    or (select count(*) from public.workspaces where kind='DEMO' and generation=3 and active) <> 1
    or (select count(*) from public.workspaces where kind='OWNER' and generation=1 and active) <> 1
    or (${dataDigest}) <> '${expectedDataDigest}'
    or (select count(*) from storage.objects) <> 0
    or (select count(*) from storage.buckets) <> 0
    or (select count(*) from supabase_migrations.schema_migrations) <> 35
    or (select max(version) from supabase_migrations.schema_migrations) <> '20260929083803'
    or (select count(*) from pg_publication_tables where schemaname in ('public','private')) <> 0
    or (select count(*) from pg_constraint co
      join pg_class source on source.oid=co.conrelid
      join pg_namespace sn on sn.oid=source.relnamespace
      join pg_class target on target.oid=co.confrelid
      join pg_namespace tn on tn.oid=target.relnamespace
      where co.contype='f' and sn.nspname not in ('public','private')
        and tn.nspname in ('public','private')) <> 0
    or ${externalDependentsSql()} <> 0
    or (select count(*) from pg_depend d join pg_extension e
      on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
      where d.deptype='e' and (
        (d.classid='pg_class'::regclass and exists(select 1 from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
          where c.oid=d.objid and n.nspname in ('public','private')))
        or (d.classid='pg_proc'::regclass and exists(select 1 from pg_proc p
          join pg_namespace n on n.oid=p.pronamespace
          where p.oid=d.objid and n.nspname in ('public','private')))
        or (d.classid='pg_type'::regclass and exists(select 1 from pg_type t
          join pg_namespace n on n.oid=t.typnamespace
          where t.oid=d.objid and n.nspname in ('public','private'))))) <> 0
  then raise exception 'TEST_REPLAY_PREFLIGHT_CHANGED'; end if;
end $guard$;
create temp table p1_test_auth_before on commit drop as
  select id, lower(email) as email, encrypted_password, email_confirmed_at, is_anonymous
  from auth.users;
create temp table p1_test_workspaces_before on commit drop as select id from public.workspaces;
${testApplicationDropSql(baseline)}
${boundedBaseline}
-- pg_dump sets an empty search_path; the reviewed name/signature fingerprint
-- was computed with the normal PostgreSQL connection search_path.
set local search_path = "$user", public;
${catalogBody(catalog)}
insert into public.profiles
  (id,auth_user_id,display_name,role,platform_role,demo_principal)
select gen_random_uuid(), u.id,
  case lower(u.email)
    when 'sejukops@superadmin.com' then 'Sejuk Ops Owner'
    when 'guest-admin@sejukops.example' then 'Demo admin principal'
    when 'guest-manager@sejukops.example' then 'Demo manager principal'
    when 'guest-technician@sejukops.example' then 'Demo technician principal'
  end,
  case lower(u.email)
    when 'guest-manager@sejukops.example' then 'MANAGER'::public.app_role
    when 'guest-technician@sejukops.example' then 'TECHNICIAN'::public.app_role
    else 'ADMIN'::public.app_role end,
  case when lower(u.email)='sejukops@superadmin.com'
    then 'SUPER_ADMIN'::public.platform_role else 'USER'::public.platform_role end,
  lower(u.email)<>'sejukops@superadmin.com'
from auth.users u;
insert into public.workspace_memberships (workspace_id,profile_id,role)
select w.id,p.id,p.role from public.profiles p
join p1_test_auth_before a on a.id=p.auth_user_id
join public.workspaces w on w.kind=case when a.email='sejukops@superadmin.com'
  then 'OWNER'::public.workspace_kind else 'DEMO'::public.workspace_kind end;
insert into public.workspace_technicians (workspace_id,profile_id,branch_id)
select w.id,p.id,b.id from public.profiles p
join p1_test_auth_before a on a.id=p.auth_user_id and a.email='guest-technician@sejukops.example'
join public.workspaces w on w.kind='DEMO' and w.active
join public.workspace_branches b on b.workspace_id=w.id and b.code='DEMO-HQ' and b.active;
do $seed$ begin
  if private.demo_seed() is not true then raise exception 'TEST_REPLAY_DEMO_SEED_FAILED'; end if;
end $seed$;
do $verify$ begin
  if (select count(*) from auth.users) <> 4
    or exists(select id,email,encrypted_password,email_confirmed_at,is_anonymous from p1_test_auth_before
      except select id,lower(email),encrypted_password,email_confirmed_at,is_anonymous from auth.users)
    or exists(select id,lower(email),encrypted_password,email_confirmed_at,is_anonymous from auth.users
      except select id,email,encrypted_password,email_confirmed_at,is_anonymous from p1_test_auth_before)
    or (select count(*) from public.workspaces) <> 2
    or (select count(*) from public.workspace_branches) <> 2
    or exists(select 1 from public.workspaces w join p1_test_workspaces_before old on old.id=w.id)
    or (select count(*) from public.profiles) <> 4
    or (select count(*) from public.profiles where auth_user_id is null) <> 0
    or (select count(*) from public.workspace_memberships) <> 4
    or (select count(*) from public.workspace_technicians) <> 1
    or (select count(*) from public.workspace_customers) <> 1
    or (select count(*) from public.workspace_orders) <> 4
    or (select count(*) from public.knowledge_documents) <> 2
    or (select count(*) from public.knowledge_versions) <> 2
    or (select count(*) from public.guest_visits) <> 0
    or (select count(*) from public.ai_provider_configs) <> 0
    or (select count(*) from private.guest_ai_budget_policy
      where singleton and daily_limit=20) <> 1
    or (select count(*) from public.workspace_orders o join public.workspaces w
      on w.id=o.workspace_id where w.kind='OWNER') <> 0
    or (select count(*) from public.profiles where platform_role='SUPER_ADMIN' and active) <> 1
    or (select count(*) from public.profiles where demo_principal and active) <> 3
    or (select count(*) from public.profiles p join auth.users u on u.id=p.auth_user_id
      where p.platform_role='SUPER_ADMIN' and p.role='ADMIN'
        and lower(u.email)='sejukops@superadmin.com') <> 1
    or (select count(*) from public.workspace_memberships m
      join public.profiles p on p.id=m.profile_id
      join public.workspaces w on w.id=m.workspace_id
      where p.platform_role='SUPER_ADMIN' and w.kind='OWNER'
        and m.role='ADMIN' and m.active) <> 1
    or (select count(*) from public.workspace_memberships m
      join public.profiles p on p.id=m.profile_id
      join public.workspaces w on w.id=m.workspace_id
      where p.demo_principal and w.kind='DEMO' and m.active and m.role=p.role) <> 3
    or (select count(*) from pg_policies where schemaname in ('public','private')) <> 12
    or ${fingerprintSql()} <> '${EXPECTED_FINGERPRINT}'
    or (select nspowner::regrole::text from pg_namespace where nspname='public') <> 'pg_database_owner'
    or (select count(*) from supabase_migrations.schema_migrations) <> 35
  then raise exception 'TEST_REPLAY_POSTCHECK_FAILED'; end if;
end $verify$;
commit;
`;
}

export function verifyFreshBackup(report, now = Date.now()) {
  if (report?.projectRef !== TEST_REF || !Number.isFinite(Date.parse(report.createdAt))
    || Math.abs(now - Date.parse(report.createdAt)) > 5 * 60_000
    || !/^[0-9a-f]{32}$/.test(report.dataDigest ?? '')
    || !/^[0-9a-f]{32}$/.test(report.authDigest ?? '')
    || report.archives?.length !== 2) throw new Error('Fresh exact-Test backup required');
  for (const archive of report.archives) {
    if (!/^test-(full|application)-[0-9A-Za-zT-]+\.dump$/.test(archive.file)) {
      throw new Error('Unexpected backup archive path');
    }
    const path = resolve(BACKUP_DIR, archive.file);
    if (statSync(path).size !== archive.bytes
      || createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase() !== archive.sha256) {
      throw new Error('Test backup hash mismatch');
    }
  }
  if (new Set(report.archives.map(item => item.file.split('-')[1])).size !== 2) {
    throw new Error('Test backup scopes incomplete');
  }
}

export function testReplayPostcheckSql() {
  return `select json_build_object(
    'fingerprint', ${fingerprintSql()},
    'authUsers', (select count(*) from auth.users),
    'readyOwner', (select count(*) from auth.users where lower(email)='sejukops@superadmin.com'
      and encrypted_password is not null and email_confirmed_at is not null),
    'fixedDemoUsers', (select count(*) from auth.users where lower(email) in
      ('guest-admin@sejukops.example','guest-manager@sejukops.example',
       'guest-technician@sejukops.example')),
    'profiles', (select count(*) from public.profiles),
    'unlinkedProfiles', (select count(*) from public.profiles where auth_user_id is null),
    'superAdmins', (select count(*) from public.profiles where platform_role='SUPER_ADMIN' and active),
    'demoPrincipals', (select count(*) from public.profiles where demo_principal and active),
    'memberships', (select count(*) from public.workspace_memberships),
    'technicians', (select count(*) from public.workspace_technicians),
    'workspaces', (select count(*) from public.workspaces),
    'branches', (select count(*) from public.workspace_branches),
    'customers', (select count(*) from public.workspace_customers),
    'orders', (select count(*) from public.workspace_orders),
    'knowledgeDocuments', (select count(*) from public.knowledge_documents),
    'guestVisits', (select count(*) from public.guest_visits),
    'providerConfigs', (select count(*) from public.ai_provider_configs),
    'policies', (select count(*) from pg_policies where schemaname in ('public','private')),
    'publicOwner', (select nspowner::regrole::text from pg_namespace where nspname='public'),
    'migrations', (select count(*) from supabase_migrations.schema_migrations),
    'anonOrdersSelect', has_table_privilege('anon','public.workspace_orders','SELECT'),
    'authenticatedOrdersInsert', has_table_privilege('authenticated','public.workspace_orders','INSERT'),
    'authenticatedOrdersSelect', has_table_privilege('authenticated','public.workspace_orders','SELECT'),
    'anonDemoSeedExecute', has_function_privilege('anon','public.demo_seed()','EXECUTE')
  )::text;`;
}

export function isTestReplayPostStateReady(state) {
  const expected = {
    fingerprint: EXPECTED_FINGERPRINT, authUsers: 4, readyOwner: 1, fixedDemoUsers: 3,
    profiles: 4, unlinkedProfiles: 0, superAdmins: 1, demoPrincipals: 3,
    memberships: 4, technicians: 1, workspaces: 2, branches: 2,
    customers: 1, orders: 4, knowledgeDocuments: 2, guestVisits: 0,
    providerConfigs: 0, policies: 12, publicOwner: 'pg_database_owner', migrations: 35,
    anonOrdersSelect: false, authenticatedOrdersInsert: false,
    authenticatedOrdersSelect: true, anonDemoSeedExecute: false,
  };
  return Object.entries(expected).every(([key, value]) => state?.[key] === value);
}

function readTestPostState(target) {
  const json = run(executable('psql'), ['--no-psqlrc','--no-password','--tuples-only',
    '--no-align','-v','ON_ERROR_STOP=1','-h',target.host,'-U','postgres','-d','postgres',
    '-c',testReplayPostcheckSql()], {
    timeout: 30_000,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on -c TimeZone=UTC' },
  });
  return JSON.parse(json.trim());
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--project-ref' || args[1] !== TEST_REF
    || !['--dry-run','--allow-live'].includes(args[2])) {
    throw new Error('Use --project-ref qobhjvrrpajoyvlgrkbx --dry-run|--allow-live');
  }
  const environment = parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'));
  const target = parseTestTarget(args.slice(0,2), environment);
  const audit = await auditFreshBaseline(ROOT);
  if (!audit.staticReady) throw new Error('Reviewed fresh baseline static audit failed');
  const baseline = readFileSync(resolve(ROOT, 'supabase/fresh/baseline.sql'), 'utf8');
  const catalog = readFileSync(resolve(ROOT, 'supabase/fresh/catalog-seed.sql'), 'utf8');
  const inspected = JSON.parse(run(process.execPath,
    [resolve(ROOT,'scripts/p1-inspect-test-replay.mjs'),'--project-ref',TEST_REF],
    { timeout: 90_000 }));
  if (!inspected.ready) throw new Error('Read-only Test inventory changed');
  if (args[2] === '--dry-run') {
    const sql = buildTestReplaySql(baseline,catalog,'0'.repeat(32));
    console.log(JSON.stringify({ projectRef: TEST_REF, ready: true,
      transactionBytes: Buffer.byteLength(sql), liveWrite: 'NOT_RUN' }));
    return;
  }
  const backup = JSON.parse(run(process.execPath,
    [resolve(ROOT,'scripts/p1-backup-test.mjs'),'--project-ref',TEST_REF],
    { timeout: 300_000 }));
  verifyFreshBackup(backup);
  const sql = buildTestReplaySql(baseline,catalog,backup.dataDigest);
  let clientFailed = false;
  try {
    run(executable('psql'), ['--no-psqlrc','--no-password','--quiet','-v','ON_ERROR_STOP=1',
      '-h',target.host,'-U','postgres','-d','postgres','-f','-'], {
      input: sql, timeout: 180_000,
      env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10' },
    });
  } catch { clientFailed = true; }
  let state;
  try { state = readTestPostState(target); } catch { /* outcome remains unverified */ }
  if (!isTestReplayPostStateReady(state)) {
    throw new Error('Test replay not verified; inspect the exact Test state and backup before any retry');
  }
  console.log(JSON.stringify({ projectRef: TEST_REF,
    replay: clientFailed ? 'COMMIT_OBSERVED_AFTER_CLIENT_ERROR' : 'COMMITTED_AND_READ_BACK',
    backupManifest: backup.manifest, postCommitBrowserAndRls: 'NOT_RUN' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Test replay failed');
    process.exitCode = 1;
  });
}
