// Read-only post-commit verification of the confirmed Test application replay.
// node scripts/p1-verify-test-replay.mjs --project-ref qobhjvrrpajoyvlgrkbx --backup-manifest <name>
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { REVIEWED_BASELINE_SHA256 } from './p1-apply-fresh-baseline.mjs';
import { parseTestTarget } from './p1-inspect-test-replay.mjs';
import { normalizeFreshBaseline } from './p1-normalize-fresh-baseline.mjs';
import { loadExactTestBackup } from './p1-restore-test.mjs';
import { isTestReplayPostStateReady, testReplayPostcheckSql } from './p1-replay-test.mjs';
import { testAuthDigestSql } from './p1-test-data-digest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'qobhjvrrpajoyvlgrkbx';

function tool(name) {
  const path = `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`;
  return process.platform === 'win32' && existsSync(path) ? path : name;
}

function run(program, args, target, timeout = 60_000) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', timeout, maxBuffer: 4_000_000, windowsHide: true,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on -c TimeZone=UTC' },
  });
  if (result.error || result.status !== 0) throw new Error('Read-only Test replay verification failed');
  return result.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--project-ref' || args[1] !== REF
    || args[2] !== '--backup-manifest') {
    throw new Error('Exact Test ref and protected backup manifest required');
  }
  const env = parseEnv(readFileSync(resolve(ROOT,'.env'),'utf8'));
  const target = parseTestTarget(args.slice(0,2),env);
  const backup = loadExactTestBackup(args[3]);
  const psqlArgs = sql => ['--no-psqlrc','--no-password','--tuples-only','--no-align',
    '-v','ON_ERROR_STOP=1','-h',target.host,'-U','postgres','-d','postgres','-c',sql];
  const state = JSON.parse(run(tool('psql'),psqlArgs(testReplayPostcheckSql()),target).trim());
  const authDigest = run(tool('psql'),psqlArgs(testAuthDigestSql()),target).trim();
  const schema = run(tool('pg_dump'), ['--no-password','--schema-only',
    '--schema=public','--schema=private','--no-owner','--no-comments',
    '-h',target.host,'-U','postgres','-d','postgres'],target,90_000);
  const schemaHash = createHash('sha256').update(normalizeFreshBaseline(schema))
    .digest('hex').toUpperCase();
  const ready = isTestReplayPostStateReady(state)
    && authDigest === backup.authDigest && schemaHash === REVIEWED_BASELINE_SHA256;
  console.log(JSON.stringify({projectRef:REF,ready,
    postStateReady:isTestReplayPostStateReady(state),
    authPreserved:authDigest === backup.authDigest,
    schemaMatchesBaseline:schemaHash === REVIEWED_BASELINE_SHA256,
    schemaSha256:schemaHash,backupManifest:args[3]}));
  if (!ready) process.exitCode=1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Test replay verification failed');
    process.exitCode=1;
  });
}
