import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildFreshReplaySql, parseFreshApplyTarget } from '../../scripts/p1-apply-fresh-baseline.mjs';
import { loadFreshProjectEnv } from '../../scripts/p1-fresh-project-env.mjs';

const args = ['--project-ref', 'abcdefghijklmnop', '--credentials-file', 'supabase/.temp/fresh.env', '--allow-live'];
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  SUPABASE_DB_PASSWORD: 'fixture-secret-never-logged',
};

test('fresh replay refuses Test, mismatched URL, and missing live flag before connecting', () => {
  assert.equal(parseFreshApplyTarget(args, environment).host, 'db.abcdefghijklmnop.supabase.co');
  assert.throws(() => parseFreshApplyTarget([
    '--project-ref', 'qobhjvrrpajoyvlgrkbx', '--credentials-file', 'supabase/.temp/fresh.env', '--allow-live',
  ], { ...environment, NEXT_PUBLIC_SUPABASE_URL: 'https://qobhjvrrpajoyvlgrkbx.supabase.co' }), /non-Test/);
  assert.throws(() => parseFreshApplyTarget(args, {
    ...environment, NEXT_PUBLIC_SUPABASE_URL: 'https://another-project.supabase.co',
  }), /matching Supabase URL/);
  assert.throws(() => parseFreshApplyTarget(args.slice(0, -1), environment), /--allow-live/);
  assert.throws(() => parseFreshApplyTarget(args, {
    ...environment, SUPABASE_DB_PASSWORD: '',
  }), /database password/);
});

test('fresh credentials cannot be loaded from the tracked repository surface', () => {
  assert.throws(() => loadFreshProjectEnv(process.cwd(), '.env'), /ignored supabase/);
  assert.throws(() => loadFreshProjectEnv(process.cwd(), 'supabase/fresh/baseline.sql'), /ignored supabase/);
  const root = mkdtempSync(join(tmpdir(), 'sejuk-fresh-env-'));
  const supabase = join(root, 'supabase');
  const ignored = join(supabase, '.temp');
  const file = join(ignored, 'fresh.env');
  try {
    mkdirSync(ignored, { recursive: true });
    writeFileSync(file, 'NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co\nSUPABASE_DB_PASSWORD=fixture-only\n');
    assert.equal(loadFreshProjectEnv(root, 'supabase/.temp/fresh.env').SUPABASE_DB_PASSWORD, 'fixture-only');
  } finally {
    unlinkSync(file);
    rmdirSync(ignored);
    rmdirSync(supabase);
    rmdirSync(root);
  }
});

test('replay binds the reviewed baseline and catalog in one guarded transaction', () => {
  const baseline = readFileSync('supabase/fresh/baseline.sql', 'utf8');
  const seed = readFileSync('supabase/fresh/catalog-seed.sql', 'utf8');
  const sql = buildFreshReplaySql(baseline, seed);
  assert.match(sql, /^begin;/);
  assert.match(sql, /SET LOCAL statement_timeout = '120s';/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET LOCAL idle_in_transaction_session_timeout = '120s';/);
  assert.doesNotMatch(sql, /^(?:SET statement_timeout|SET lock_timeout|SET idle_in_transaction_session_timeout) = 0;$/m);
  assert.match(sql, /to_regclass\('public\.workspaces'\) is not null/);
  assert.match(sql, /from auth\.users/);
  assert.match(sql, /from storage\.objects/);
  assert.equal([...sql.matchAll(/^begin;$/gim)].length, 1);
  assert.equal([...sql.matchAll(/^commit;$/gim)].length, 1);
  assert.match(sql, /insert into public\.workspaces/);
  assert.throws(() => buildFreshReplaySql(`${baseline}\n-- drift`, seed), /hash changed/);
  assert.throws(() => buildFreshReplaySql(baseline, `${seed}\nbegin;`), /transaction shape/);
});
