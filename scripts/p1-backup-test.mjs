// Logical safety copies of the confirmed Test database. This script never restores.
// node scripts/p1-backup-test.mjs --project-ref qobhjvrrpajoyvlgrkbx
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { parseTestTarget } from './p1-inspect-test-replay.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_REF = 'qobhjvrrpajoyvlgrkbx';
const BACKUP_DIR = resolve(ROOT, 'supabase/.temp/backups');

function postgresTool(name) {
  const windowsPath = `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`;
  return process.platform === 'win32' && existsSync(windowsPath) ? windowsPath : name;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout: 90_000, maxBuffer: 2_000_000,
    windowsHide: true, ...options,
  });
  if (result.error || result.status !== 0) throw new Error(`${executable.split(/[\\/]/).at(-1)} failed`);
  return result.stdout;
}

function restrictBackupDirectory(directory) {
  if (process.platform !== 'win32') {
    throw new Error('Test backup ACL setup is implemented for this Windows host only');
  }
  const identity = run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
  const account = identity.split(',')[0]?.replace(/^"|"$/g, '').trim();
  const sid = identity.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if (!account || !sid) throw new Error('Could not determine the local backup owner SID');
  mkdirSync(directory, { recursive: true });
  run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]);
  const acl = run('icacls.exe', [directory]);
  if (!acl.toLowerCase().includes(account.toLowerCase())
    || /Everyone|Authenticated Users|BUILTIN\\Users/i.test(acl)) {
    throw new Error('Backup directory permissions were not restricted');
  }
}

export function verifyArchiveList(list, scope) {
  const required = scope === 'full'
    ? [/\bTABLE DATA auth users\b/, /\bTABLE DATA public profiles\b/, /\bTABLE DATA public workspace_orders\b/]
    : scope === 'application'
      ? [/\bTABLE DATA public profiles\b/, /\bTABLE DATA public workspace_orders\b/,
        /\bTABLE DATA private guest_ai_budget_policy\b/]
      : null;
  if (!required || required.some(pattern => !pattern.test(list))) {
    throw new Error(`The ${scope} backup archive is missing required table data entries`);
  }
  return list.split('\n').filter(line => /^\d+;/.test(line)).length;
}

function createArchive(scope, filename, target) {
  const args = [
    '--no-password', '--format=custom', '--compress=6',
    '-h', target.host, '-U', 'postgres', '-d', 'postgres',
    '--file', filename,
  ];
  if (scope === 'application') args.push('--schema=public', '--schema=private');
  const env = { ...process.env, PGPASSWORD: target.password,
    PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10' };
  run(postgresTool('pg_dump'), args, { env, timeout: 120_000 });
  const list = run(postgresTool('pg_restore'), ['--list', filename]);
  const tocEntries = verifyArchiveList(list, scope);
  // Parse every archive stream without connecting to, or writing to, a database.
  run(postgresTool('pg_restore'), ['--file=NUL', filename], { timeout: 120_000 });
  const bytes = statSync(filename).size;
  if (bytes < 1024) throw new Error('Backup archive is unexpectedly small');
  const sha256 = createHash('sha256').update(readFileSync(filename)).digest('hex').toUpperCase();
  return { file: filename.split(/[\\/]/).at(-1), bytes, sha256, tocEntries };
}

function main() {
  const environment = parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'));
  const target = parseTestTarget(process.argv.slice(2), environment);
  restrictBackupDirectory(BACKUP_DIR);
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const full = join(BACKUP_DIR, `test-full-${stamp}.dump`);
  const application = join(BACKUP_DIR, `test-application-${stamp}.dump`);
  const manifest = join(BACKUP_DIR, `test-backup-${stamp}.json`);
  try {
    const archives = [
      createArchive('full', full, target),
      createArchive('application', application, target),
    ];
    const report = {
      projectRef: TEST_REF, createdAt: new Date().toISOString(),
      sourceHost: target.host, archives,
      verification: 'Both custom archives were listed and fully extracted without a database connection.',
      liveRestore: 'NOT_RUN',
    };
    writeFileSync(manifest, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ manifest: manifest.split(/[\\/]/).at(-1), ...report }, null, 2));
  } catch (error) {
    // Incomplete archives must not be mistaken for usable backups.
    for (const file of [full, application, manifest]) {
      if (existsSync(file)) unlinkSync(file);
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Test backup failed');
    process.exitCode = 1;
  }
}
