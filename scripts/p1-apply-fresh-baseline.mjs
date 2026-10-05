// Apply the reviewed post-retirement schema and fixed catalog to a disposable,
// empty Supabase project. Never point this at the prepared Test project.
// node scripts/p1-apply-fresh-baseline.mjs --project-ref <ref> --credentials-file supabase/.temp/fresh.env --allow-live
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditFreshBaseline } from './p1-audit-fresh-baseline.mjs';
import { loadFreshProjectEnv } from './p1-fresh-project-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_REF = 'qobhjvrrpajoyvlgrkbx';
export const REVIEWED_BASELINE_SHA256 = 'C259221764D6217449208AEF54DD808ACC1D9D0B6907E7796125A284A7719B89';
const DASHBOARD_MIGRATION = 'supabase/migrations/20261005152655_operations_dashboard_activity.sql';
const DASHBOARD_SHA256 = 'A29A9525425301B41D08A45851F6D8ECBE8826C07AE9981487266BB21672FD1F';

export function parseFreshApplyTarget(argv, environment) {
  const args = argv.slice();
  if (args.pop() !== '--allow-live' || args.length !== 4) {
    throw new Error('Use --project-ref <ref> --credentials-file <ignored-file> --allow-live');
  }
  const fields = new Map();
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!['--project-ref', '--credentials-file'].includes(flag) || !value || value.startsWith('--') || fields.has(flag)) {
      throw new Error('Fresh schema arguments are invalid');
    }
    fields.set(flag, value);
  }
  const ref = fields.get('--project-ref');
  const envFile = fields.get('--credentials-file');
  if (!/^[a-z0-9]{8,32}$/.test(ref ?? '') || ref === TEST_REF || !envFile) {
    throw new Error('Fresh schema requires an explicit non-Test project ref');
  }
  let parsed;
  try { parsed = new URL(environment.NEXT_PUBLIC_SUPABASE_URL); } catch { /* fail closed below */ }
  if (parsed?.protocol !== 'https:' || parsed.hostname !== `${ref}.supabase.co`
    || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash || !environment.SUPABASE_DB_PASSWORD) {
    throw new Error('Fresh schema requires matching Supabase URL and database password');
  }
  return { ref, host: `db.${ref}.supabase.co`, envFile, password: environment.SUPABASE_DB_PASSWORD };
}

function catalogBody(seed) {
  const starts = [...seed.matchAll(/^begin;\s*$/gim)];
  const ends = [...seed.matchAll(/^commit;\s*$/gim)];
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
    throw new Error('Fresh catalog transaction shape changed; review before replay');
  }
  return seed.replace(/^begin;\s*$/im, '').replace(/^commit;\s*$/im, '');
}

export function buildFreshReplaySql(baseline, seed) {
  if (createHash('sha256').update(baseline).digest('hex').toUpperCase() !== REVIEWED_BASELINE_SHA256) {
    throw new Error('Fresh baseline hash changed; independent review required before replay');
  }
  const boundedBaseline = baseline
    .replace(/^SET statement_timeout = 0;$/m, "SET LOCAL statement_timeout = '120s';")
    .replace(/^SET lock_timeout = 0;$/m, "SET LOCAL lock_timeout = '5s';")
    .replace(/^SET idle_in_transaction_session_timeout = 0;$/m,
      "SET LOCAL idle_in_transaction_session_timeout = '120s';");
  if (boundedBaseline === baseline ||
    /^(?:SET statement_timeout|SET lock_timeout|SET idle_in_transaction_session_timeout) = 0;$/m
      .test(boundedBaseline)) {
    throw new Error('Fresh baseline timeout statements changed; review before replay');
  }
  // Append only this reviewed feature to the pinned schema, never retirement SQL.
  const dashboardMigration = readFileSync(resolve(ROOT, DASHBOARD_MIGRATION), 'utf8');
  if (createHash('sha256').update(dashboardMigration).digest('hex').toUpperCase() !== DASHBOARD_SHA256) {
    throw new Error('Dashboard migration hash changed; review required before fresh replay');
  }
  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
do $$ begin
  if current_setting('server_version_num')::int not between 170000 and 179999 then
    raise exception 'Fresh replay requires PostgreSQL 17';
  end if;
  if to_regnamespace('auth') is null or to_regnamespace('storage') is null
    or to_regnamespace('extensions') is null or to_regnamespace('private') is not null
    or to_regclass('public.workspaces') is not null
    or to_regclass('public.profiles') is not null then
    raise exception 'Fresh replay requires untouched Supabase application schemas';
  end if;
  if (select count(*) from auth.users) <> 0 or (select count(*) from storage.objects) <> 0 then
    raise exception 'Fresh replay requires empty Auth and Storage objects';
  end if;
end $$;
${boundedBaseline}
${catalogBody(seed)}
${dashboardMigration}
do $$ begin
  if (select count(*) from public.workspaces) <> 2
    or (select count(*) from public.workspace_branches) <> 2
    or (select count(*) from private.guest_ai_budget_policy where singleton and daily_limit = 20) <> 1
    or (select count(*) from public.profiles) <> 0
    or (select count(*) from public.workspace_orders) <> 0
    or (select count(*) from private.staff_accounts) <> 0
    or (select count(*) from private.staff_provisioning) <> 0
    or (select count(*) from private.staff_password_claims) <> 0
    or (select count(*) from private.owner_previews) <> 0
    or (select count(*) from private.staff_imports) <> 0
    or (select count(*) from private.staff_import_rows) <> 0
    or (select count(*) from private.staff_password_resets) <> 0
    or to_regprocedure('public.workspace_dashboard_activity(uuid,bigint,text,uuid,text)') is null then
    raise exception 'Fresh catalog result differs from reviewed empty-project state';
  end if;
end $$;
commit;
`;
}

function psqlExecutable() {
  const windowsPath = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
  return process.platform === 'win32' && existsSync(windowsPath) ? windowsPath : 'psql';
}

async function main() {
  const args = process.argv.slice(2);
  const refIndex = args.indexOf('--project-ref');
  if (refIndex < 0 || !/^[a-z0-9]{8,32}$/.test(args[refIndex + 1] ?? '')
    || args[refIndex + 1] === TEST_REF) {
    throw new Error('Fresh schema requires an explicit non-Test project ref');
  }
  const envIndex = args.indexOf('--credentials-file');
  if (envIndex < 0 || !args[envIndex + 1]) throw new Error('Fresh schema requires --credentials-file');
  const environment = loadFreshProjectEnv(ROOT, args[envIndex + 1]);
  const target = parseFreshApplyTarget(args, environment);
  const audit = await auditFreshBaseline(ROOT);
  if (!audit.staticReady) throw new Error(`Fresh baseline static audit failed: ${audit.blockers.join(', ')}`);
  const baseline = readFileSync(resolve(ROOT, 'supabase/fresh/baseline.sql'), 'utf8');
  const seed = readFileSync(resolve(ROOT, 'supabase/fresh/catalog-seed.sql'), 'utf8');
  const sql = buildFreshReplaySql(baseline, seed);
  const result = spawnSync(psqlExecutable(), [
    '--no-psqlrc', '--no-password', '--quiet', '-v', 'ON_ERROR_STOP=1',
    '-h', target.host, '-U', 'postgres', '-d', 'postgres', '-f', '-',
  ], {
    input: sql, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000,
    windowsHide: true,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Fresh schema replay failed; transaction should be rolled back. ${String(result.stderr ?? result.error?.message ?? '').trim().slice(-600)}`);
  }
  console.log(`Fresh schema and catalog applied to disposable project ${target.ref}; Auth identities are still absent.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Fresh schema replay failed');
    process.exitCode = 1;
  });
}
