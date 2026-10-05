// Read-only schema export from the confirmed Test; no rows or managed schemas.
// Credentials stay in the existing helper's internal environment, never output.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseTestTarget } from './p1-inspect-test-replay.mjs';
import { normalizeFreshBaseline } from './p1-normalize-fresh-baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function reviewSchemaOnlyCandidate(raw) {
  const baseline = normalizeFreshBaseline(raw);
  const topLevel = baseline.replace(/(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1/g, '\n-- function body removed\n');
  // This existing source-defined singleton is a schema invariant, not a user,
  // provider configuration or project ID (also pinned by ai-config/service.ts).
  const schemaSingletonId = '00000000-0000-4000-8000-00000000a100';
  const uuidLiterals = [...baseline.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)];
  const flags = {
    topLevelData: /^\s*(?:copy|insert|update|delete|truncate)\b/im.test(topLevel),
    projectUrl: /https?:\/\/[^\s'"]*supabase\.(?:co|com)/i.test(baseline),
    literalUuid: uuidLiterals.some(match => match[0].toLowerCase() !== schemaSingletonId),
    credentialPattern: /(?:sb_secret_|sb_publishable_|sk-[a-zA-Z0-9]{16})/.test(baseline),
  };
  if (Object.values(flags).some(Boolean)) {
    const uuidContexts = flags.literalUuid ? baseline.split(/(?=^CREATE )/m).filter(block =>
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(block)).map(block =>
      block.match(/^CREATE (?:FUNCTION|TABLE|POLICY|TYPE|TRIGGER|INDEX) [a-z_][a-z0-9_.]*/m)?.[0] ?? 'non-CREATE block') : [];
    throw new Error(`Schema export requires review: ${Object.entries(flags).filter(([, value]) => value).map(([key]) => key).join(', ')}; object contexts: ${uuidContexts.join(', ')}; raw output suppressed`);
  }
  return baseline;
}

function main() {
  const environment = parseEnv(readFileSync(resolve(ROOT, '.env'), 'utf8'));
  const target = parseTestTarget(process.argv.slice(2), environment);
  const installed = 'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe';
  const executable = process.platform === 'win32' && existsSync(installed) ? installed : 'pg_dump';
  const dump = spawnSync(executable, ['--no-password', '--schema-only', '--schema=public', '--schema=private',
    '--no-owner', '--no-comments', '-h', target.host, '-U', 'postgres', '-d', 'postgres'], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4_000_000, windowsHide: true,
    env: { ...process.env, PGPASSWORD: target.password, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c default_transaction_read_only=on' },
  });
  if (dump.error || dump.status !== 0) throw new Error('Read-only schema export failed; raw diagnostics suppressed');
  const baseline = reviewSchemaOnlyCandidate(dump.stdout);
  writeFileSync(resolve(ROOT, 'supabase/fresh/baseline.sql'), baseline, 'utf8');
  console.log(JSON.stringify({ schemaOnly: true, schemas: ['public', 'private'], bytes: Buffer.byteLength(baseline),
    baselineSha256: createHash('sha256').update(baseline).digest('hex').toUpperCase() }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Read-only schema export failed');
    process.exitCode = 1;
  }
}
