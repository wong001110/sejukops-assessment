// Explicit opt-in, confirmed Test only. No JWT login, email or model calls.
import { spawnSync } from 'node:child_process';
if (process.argv.length !== 3 || process.argv[2] !== '--allow-live') {
  console.error('Usage: node scripts/red-team-live-concurrency.mjs --allow-live');
  process.exit(2);
}
process.loadEnvFile('.env');
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://qobhjvrrpajoyvlgrkbx.supabase.co' ||
    !process.env.SUPABASE_DB_PASSWORD) {
  console.error('Refusing: exact Test URL and database password required.');
  process.exit(2);
}
// Python receives only its runtime environment and this one credential in memory.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|PYTHON.*)$/i.test(key)));
const result = spawnSync('python', ['scripts/red-team-live-concurrency.py', '--allow-live'], {
  env: { ...env, PYTHONUTF8: '1', SEJUK_REDTEAM_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD },
  encoding: 'utf8', windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
// The Python runner emits only fixed labels and SQLSTATEs, never raw exceptions.
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
