// Exercise the exact Test application archive on hosted Test, then ROLLBACK.
// No committed database change is made by this rehearsal.
// node scripts/p1-rehearse-hosted-restore.mjs --project-ref qobhjvrrpajoyvlgrkbx --backup-manifest <name> --rehearse
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { REVIEWED_BASELINE_SHA256 } from './p1-apply-fresh-baseline.mjs';
import { parseTestTarget } from './p1-inspect-test-replay.mjs';
import { normalizeFreshBaseline } from './p1-normalize-fresh-baseline.mjs';
import { loadExactTestBackup, normalizeTestArchiveSql } from './p1-restore-test.mjs';
import { externalDependentsSql, fingerprintSql, reviewedPublicTableNames,
  testApplicationDropSql } from './p1-replay-test.mjs';
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
  const { safeDetail = false, ...spawnOptions } = options;
  const result = spawnSync(program, args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 8_000_000,
    windowsHide: true, ...spawnOptions,
  });
  if (result.error || result.status !== 0) {
    // Database diagnostics may include private values; do not print them.
    const stderr = String(result.stderr ?? '');
    const deniedObject = /permission denied for (schema|table|relation|sequence|function) ([a-z_][a-z_0-9.]*)/i
      .exec(stderr);
    const scriptLine = /psql:<stdin>:(\d+):\s*ERROR:/i.exec(stderr)?.[1];
    const category = /TEST_HOSTED_REHEARSAL_(?:PREFLIGHT_CHANGED|RESTORE_FAILED)/.exec(stderr)?.[0]
      ?? (deniedObject ? `permission denied for ${deniedObject[1]} ${deniedObject[2]}` : null)
      ?? ['permission denied', 'lock timeout', 'statement timeout', 'syntax error',
        'already exists', 'does not exist', 'invalid command', 'cannot drop',
        'connection to server failed'].find(item => stderr.toLowerCase().includes(item))
      ?? (result.error?.code === 'ETIMEDOUT' ? 'client timeout' : 'unclassified');
    const safeError = safeDetail ? /ERROR:\s+([A-Za-z _0-9.]+)/.exec(stderr)?.[1]?.trim() : null;
    throw new Error(`${program.split(/[\\/]/).at(-1)} failed (${category}`
      + `${scriptLine ? ` at SQL line ${scriptLine}` : ''}`
      + `${safeError ? `: ${safeError}` : ''})`);
  }
  return result.stdout;
}

function connectionEnv(target, readOnly = true) {
  return {
    ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require',
    PGCONNECT_TIMEOUT: '10',
    ...(readOnly ? { PGOPTIONS: '-c default_transaction_read_only=on -c TimeZone=UTC' } : {}),
  };
}

function readSql(target, sql, safeDetail = false) {
  return run(tool('psql'), ['--no-psqlrc', '--no-password', '--tuples-only', '--no-align',
    '-v', 'ON_ERROR_STOP=1', '-h', target.host, '-U', 'postgres', '-d', 'postgres', '-c', sql],
  { timeout: 30_000, env: connectionEnv(target), safeDetail }).trim();
}

function schemaHash(target) {
  const schema = run(tool('pg_dump'), ['--no-password', '--schema-only',
    '--schema=public', '--schema=private', '--no-owner', '--no-comments',
    '-h', target.host, '-U', 'postgres', '-d', 'postgres'],
  { timeout: 90_000, env: connectionEnv(target) });
  return createHash('sha256').update(normalizeFreshBaseline(schema)).digest('hex').toUpperCase();
}

function managedBoundary(target) {
  return readSql(target, `select json_build_object(
    'authUsers', (select count(*) from auth.users),
    'storageObjects', (select count(*) from storage.objects),
    'storageBuckets', (select count(*) from storage.buckets),
    'migrationRows', (select count(*) from supabase_migrations.schema_migrations)
  )::text;`);
}

function publicDefaultAclDigest(target) {
  return readSql(target, `select md5(coalesce(string_agg(
    defaclrole::text || ':' || defaclnamespace::text || ':' || defaclobjtype::text || ':'
      || coalesce(defaclacl::text, ''), E'\\n'
    order by defaclrole, defaclnamespace, defaclobjtype), ''))
  from pg_default_acl where defaclnamespace='public'::regnamespace;`, true);
}

export function assertCurrentTestSnapshot(report, targetHost, now = Date.now()) {
  if (report?.projectRef !== REF || report.sourceHost !== targetHost
    || !Number.isFinite(Date.parse(report.createdAt))
    || now - Date.parse(report.createdAt) < 0
    || now - Date.parse(report.createdAt) > 30 * 60_000) {
    throw new Error('A fresh backup of the exact current Test host is required');
  }
  const stamp = /^test-backup-(.+)\.json$/.exec(report.manifestName ?? '')?.[1];
  if (!stamp || !Array.isArray(report.archives)
    || !['full', 'application'].every(scope => report.archives.some(
      archive => archive.file === `test-${scope}-${stamp}.dump`))) {
    throw new Error('Test backup manifest and archive identities differ');
  }
}

export function buildHostedRestoreRehearsalSql(baseline, archiveSql, report) {
  if (createHash('sha256').update(baseline).digest('hex').toUpperCase() !== REVIEWED_BASELINE_SHA256
    || !/^[0-9a-f]{32}$/.test(report?.dataDigest ?? '')
    || !/^[0-9a-f]{32}$/.test(report?.authDigest ?? '')) {
    throw new Error('Reviewed baseline or backup digest changed');
  }
  const publicTables = reviewedPublicTableNames(baseline).map(name => `public.${name}`);
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
lock table ${[...publicTables, ...privateTables].join(', ')} in access exclusive mode;
do $guard$ begin
  if current_database()<>'postgres' or current_user<>'postgres'
    or current_setting('server_version_num')::int not between 170000 and 179999
    or (select nspowner::regrole::text from pg_namespace where nspname='public')<>'pg_database_owner'
    or (select count(*) from auth.users)<>4
    or (select count(*) from storage.objects)<>0
    or (select count(*) from storage.buckets)<>0
    or (select count(*) from supabase_migrations.schema_migrations)<>35
    or (select count(*) from pg_publication_tables where schemaname in ('public','private'))<>0
    or ${fingerprintSql()}<>'${FINGERPRINT}'
    or ${externalDependentsSql()}<>0
    or (${appDigest})<>'${report.dataDigest}'
    or (${authDigest})<>'${report.authDigest}'
  then raise exception 'TEST_HOSTED_REHEARSAL_PREFLIGHT_CHANGED'; end if;
end $guard$;
${testApplicationDropSql(baseline)}
${normalizeTestArchiveSql(archiveSql, { requireManagedDefaults: true })}
set local search_path = "$user", public;
do $verify$ begin
  if (${appDigest})<>'${report.dataDigest}'
    or (${authDigest})<>'${report.authDigest}'
    or ${fingerprintSql()}<>'${FINGERPRINT}'
    or (select nspowner::regrole::text from pg_namespace where nspname='public')<>'pg_database_owner'
    or (select count(*) from supabase_migrations.schema_migrations)<>35
    or (select count(*) from pg_policies where schemaname in ('public','private'))<>12
    or (select count(*) from pg_constraint co join pg_class c on c.oid=co.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and co.contype='f')<>32
    or exists(select 1 from pg_constraint co join pg_class c on c.oid=co.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and co.contype='f' and not co.convalidated)
    or has_table_privilege('anon','public.workspace_orders','SELECT')
    or has_table_privilege('authenticated','public.workspace_orders','INSERT')
    or not has_table_privilege('authenticated','public.workspace_orders','SELECT')
    or has_function_privilege('anon','public.demo_seed()','EXECUTE')
  then raise exception 'TEST_HOSTED_REHEARSAL_RESTORE_FAILED'; end if;
end $verify$;
rollback;
`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5 || args[0] !== '--project-ref' || args[1] !== REF
    || args[2] !== '--backup-manifest' || !['--inspect', '--rehearse'].includes(args[4])) {
    throw new Error('Use exact Test ref, --backup-manifest <name>, --inspect|--rehearse');
  }
  const env = parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'));
  const target = parseTestTarget(args.slice(0, 2), env);
  const report = loadExactTestBackup(args[3]);
  report.manifestName = args[3];
  assertCurrentTestSnapshot(report, target.host);
  const baseline = readFileSync(resolve(ROOT, 'supabase/fresh/baseline.sql'), 'utf8');
  const archive = report.archives.find(item => item.file.startsWith('test-application-'));
  const archiveSql = run(tool('pg_restore'), ['--no-owner', '--file=-',
    resolve(BACKUP_DIR, archive.file)]);
  const sql = buildHostedRestoreRehearsalSql(baseline, archiveSql, report);
  const beforeManaged = managedBoundary(target);
  const beforeDefaults = publicDefaultAclDigest(target);
  const schemaMatches = schemaHash(target) === REVIEWED_BASELINE_SHA256;
  const dataMatches = readSql(target, testDataDigestSql(baseline)) === report.dataDigest;
  const authMatches = readSql(target, testAuthDigestSql()) === report.authDigest;
  if (args[4] === '--inspect') {
    console.log(JSON.stringify({ projectRef: REF, backupManifest: args[3],
      schemaMatches, dataMatches, authMatches, transaction: 'NOT_RUN' }));
    if (!schemaMatches || !dataMatches || !authMatches) process.exitCode = 1;
    return;
  }
  if (!schemaMatches || !dataMatches || !authMatches) {
    throw new Error('Current Test state differs from the fresh protected backup');
  }
  let transactionError = null;
  try {
    run(tool('psql'), ['--no-psqlrc', '--no-password', '--quiet', '-v', 'ON_ERROR_STOP=1',
      '-h', target.host, '-U', 'postgres', '-d', 'postgres', '-f', '-'],
    { input: sql, timeout: 180_000, env: connectionEnv(target, false) });
  } catch (error) { transactionError = error; }
  const unchanged = readSql(target, testDataDigestSql(baseline)) === report.dataDigest
    && readSql(target, testAuthDigestSql()) === report.authDigest
    && schemaHash(target) === REVIEWED_BASELINE_SHA256
    && managedBoundary(target) === beforeManaged
    && publicDefaultAclDigest(target) === beforeDefaults;
  if (transactionError || !unchanged) {
    throw new Error(`Hosted restore rehearsal failed: ${transactionError?.message ?? 'SQL returned'}; `
      + `Test unchanged=${unchanged}`);
  }
  console.log(JSON.stringify({ projectRef: REF, backupManifest: args[3],
    applicationRestore: 'EXECUTED_AND_ROLLED_BACK', testStateUnchanged: true,
    managedAuthRestore: 'NOT_RUN', fullRawArchiveRestore: 'NOT_RUN' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Hosted restore rehearsal failed');
    process.exitCode = 1;
  }
}
