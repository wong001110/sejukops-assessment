// Emergency rollback of a committed Test application replay from an exact
// protected pre-replay archive. Preserves managed public/Auth/Storage schemas.
// Run only after inspecting a failed post-replay acceptance gate.
// node scripts/p1-restore-test.mjs --project-ref qobhjvrrpajoyvlgrkbx --backup-manifest <name> --dry-run
// node scripts/p1-restore-test.mjs --project-ref qobhjvrrpajoyvlgrkbx --backup-manifest <name> --allow-live
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { REVIEWED_BASELINE_SHA256 } from './p1-apply-fresh-baseline.mjs';
import { parseTestTarget } from './p1-inspect-test-replay.mjs';
import { externalDependentsSql, fingerprintSql, isTestReplayPostStateReady,
  reviewedPublicTableNames, testApplicationDropSql,
  testReplayPostcheckSql } from './p1-replay-test.mjs';
import { testAuthDigestSql, testDataDigestSql } from './p1-test-data-digest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'qobhjvrrpajoyvlgrkbx';
const BACKUP_DIR = resolve(ROOT, 'supabase/.temp/backups');
const FINGERPRINT = '0574ac207e44fed88d2c51cc5533d8c8';

function tool(name) {
  const path = `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`;
  return process.platform === 'win32' && existsSync(path) ? path : name;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 8_000_000,
    windowsHide: true, ...options,
  });
  if (result.error || result.status !== 0) throw new Error(`${program.split(/[\\/]/).at(-1)} failed`);
  return result.stdout;
}

export function loadExactTestBackup(manifestName) {
  if (basename(manifestName ?? '') !== manifestName
    || !/^test-backup-[0-9A-Za-zT-]+\.json$/.test(manifestName)) {
    throw new Error('Exact protected Test backup manifest name required');
  }
  const report = JSON.parse(readFileSync(resolve(BACKUP_DIR, manifestName), 'utf8'));
  if (report.projectRef !== REF || !/^[0-9a-f]{32}$/.test(report.dataDigest ?? '')
    || !/^[0-9a-f]{32}$/.test(report.authDigest ?? '')
    || report.archives?.length !== 2) throw new Error('Backup manifest not suitable for Test rollback');
  const scopes = new Set();
  for (const archive of report.archives) {
    const match = /^test-(full|application)-[0-9A-Za-zT-]+\.dump$/.exec(archive.file ?? '');
    if (!match || !/^[0-9A-F]{64}$/.test(archive.sha256 ?? '')) {
      throw new Error('Backup archive identity invalid');
    }
    scopes.add(match[1]);
    const path = resolve(BACKUP_DIR, archive.file);
    if (statSync(path).size !== archive.bytes
      || createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase() !== archive.sha256) {
      throw new Error('Backup archive hash mismatch');
    }
  }
  if (scopes.size !== 2) throw new Error('Full and application backups are both required');
  return report;
}

export function normalizeTestArchiveSql(sql) {
  if ((sql.match(/^CREATE SCHEMA public;$/gm) ?? []).length !== 1
    || (sql.match(/^CREATE SCHEMA private;$/gm) ?? []).length !== 1
    || /^(?:DROP SCHEMA\b|BEGIN;|COMMIT;)/im.test(sql)) {
    throw new Error('Application archive SQL shape changed');
  }
  return sql.replace(/^CREATE SCHEMA public;$/m,
    '-- Preserve the managed public schema and its owner during Test rollback.')
    .replace(/^SET statement_timeout = 0;$/m, "SET LOCAL statement_timeout = '120s';")
    .replace(/^SET lock_timeout = 0;$/m, "SET LOCAL lock_timeout = '5s';")
    .replace(/^SET idle_in_transaction_session_timeout = 0;$/m,
      "SET LOCAL idle_in_transaction_session_timeout = '120s';")
    .replace(/^SET transaction_timeout = 0;$/m,
      "SET LOCAL transaction_timeout = '120s';");
}

export function buildTestRestoreSql(baseline, archiveSql, report) {
  if (createHash('sha256').update(baseline).digest('hex').toUpperCase() !== REVIEWED_BASELINE_SHA256
    || !/^[0-9a-f]{32}$/.test(report?.dataDigest ?? '')
    || !/^[0-9a-f]{32}$/.test(report?.authDigest ?? '')) {
    throw new Error('Reviewed baseline or exact backup digest changed');
  }
  const publicTables = reviewedPublicTableNames(baseline);
  const privateTables = [...baseline.matchAll(/^CREATE TABLE private\.([a-z_][a-z_0-9]*)\s*\(/gm)]
    .map(match => `private.${match[1]}`);
  if (privateTables.length !== 6) throw new Error('Reviewed private table set changed');
  const appDigest = testDataDigestSql(baseline).replace(/;\s*$/, '');
  const authDigest = testAuthDigestSql().replace(/;\s*$/, '');
  return `begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';
set local time zone 'UTC';
set local client_min_messages = warning;
lock table auth.users, storage.objects, storage.buckets,
  supabase_migrations.schema_migrations in share mode;
lock table ${[...publicTables.map(name => `public.${name}`), ...privateTables].join(', ')}
  in access exclusive mode;
do $guard$ begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('server_version_num')::int not between 170000 and 179999
    or (select nspowner::regrole::text from pg_namespace where nspname='public')<>'pg_database_owner'
    or (select count(*) from public.profiles)<>4
    or (select count(*) from public.guest_visits)<>0
    or (select count(*) from public.ai_provider_configs)<>0
    or ${fingerprintSql()}<>'${FINGERPRINT}'
    or ${externalDependentsSql()}<>0
    or (select count(*) from auth.users)<>4
    or (${authDigest})<>'${report.authDigest}'
    or (select count(*) from storage.objects)<>0
    or (select count(*) from storage.buckets)<>0
    or (select count(*) from supabase_migrations.schema_migrations)<>35
  then raise exception 'TEST_ROLLBACK_PREFLIGHT_CHANGED'; end if;
end $guard$;
${testApplicationDropSql(baseline)}
${normalizeTestArchiveSql(archiveSql)}
set local search_path = "$user", public;
do $verify$ begin
  if (${appDigest})<>'${report.dataDigest}'
    or (${authDigest})<>'${report.authDigest}'
    or (select count(*) from public.profiles)<>10
    or (select count(*) from public.workspace_memberships)<>4
    or (select count(*) from public.workspace_orders)<>4
    or (select count(*) from public.knowledge_documents)<>2
    or (select count(*) from public.ai_provider_configs)<>1
    or (select count(*) from pg_policies where schemaname in ('public','private'))<>12
    or ${fingerprintSql()}<>'${FINGERPRINT}'
    or (select nspowner::regrole::text from pg_namespace where nspname='public')<>'pg_database_owner'
    or (select count(*) from supabase_migrations.schema_migrations)<>35
    or has_table_privilege('anon','public.workspace_orders','SELECT')
    or has_table_privilege('authenticated','public.workspace_orders','INSERT')
    or not has_table_privilege('authenticated','public.workspace_orders','SELECT')
  then raise exception 'TEST_ROLLBACK_POSTCHECK_FAILED'; end if;
end $verify$;
commit;
`;
}

function readOnly(target, sql) {
  return run(tool('psql'), ['--no-psqlrc','--no-password','--tuples-only','--no-align',
    '-v','ON_ERROR_STOP=1','-h',target.host,'-U','postgres','-d','postgres','-c',sql], {
    timeout: 30_000,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE:'require',
      PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c default_transaction_read_only=on -c TimeZone=UTC' },
  }).trim();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5 || args[0] !== '--project-ref' || args[1] !== REF
    || args[2] !== '--backup-manifest' || !['--dry-run','--allow-live'].includes(args[4])) {
    throw new Error('Use exact Test ref, --backup-manifest <name>, --dry-run|--allow-live');
  }
  const env = parseEnv(readFileSync(resolve(ROOT,'.env'),'utf8'));
  const target = parseTestTarget(args.slice(0,2),env);
  const report = loadExactTestBackup(args[3]);
  const baseline = readFileSync(resolve(ROOT,'supabase/fresh/baseline.sql'),'utf8');
  const archive = report.archives.find(item => item.file.startsWith('test-application-'));
  const archiveSql = run(tool('pg_restore'), ['--no-owner','--file=-',
    resolve(BACKUP_DIR,archive.file)], { timeout: 120_000 });
  const sql = buildTestRestoreSql(baseline,archiveSql,report);
  const current = JSON.parse(readOnly(target,testReplayPostcheckSql()));
  if (!isTestReplayPostStateReady(current)) throw new Error('Test is not in the exact post-replay state');
  if (readOnly(target,testAuthDigestSql()) !== report.authDigest) {
    throw new Error('Managed Test Auth identity digest changed');
  }
  if (args[4] === '--dry-run') {
    console.log(JSON.stringify({ projectRef:REF,rollbackReady:true,liveWrite:'NOT_RUN' }));
    return;
  }
  let clientFailed = false;
  try {
    run(tool('psql'), ['--no-psqlrc','--no-password','--quiet','-v','ON_ERROR_STOP=1',
      '-h',target.host,'-U','postgres','-d','postgres','-f','-'], {
      input:sql,timeout:180_000,
      env:{...process.env,PGPASSWORD:target.password,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'},
    });
  } catch { clientFailed = true; }
  let restored;
  try { restored = readOnly(target,testDataDigestSql(baseline)); } catch { /* uncertain */ }
  if (restored !== report.dataDigest) {
    throw new Error('Test rollback not verified; inspect the exact Test state before any retry');
  }
  console.log(JSON.stringify({projectRef:REF,
    rollback:clientFailed?'RESTORE_OBSERVED_AFTER_CLIENT_ERROR':'RESTORED_AND_READ_BACK',
    backupManifest:args[3]}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Test rollback failed');
    process.exitCode=1;
  });
}
