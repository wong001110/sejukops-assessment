// One bounded live-provider run against empty fictional Demo data in the confirmed Test project.
// Prepare: P2_AGENT_HTTP_BASE_URL=http://127.0.0.1:3100 node scripts/p2-live-agent-provider.mjs --prepare --allow-live
// Execute the generated exact-ID SQL through the trusted Supabase SQL connector.
// Finish: node scripts/p2-live-agent-provider.mjs --finish --allow-live <run-id>
// No provider credential, prompt, HTTP body, or Auth token is printed or persisted.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMP = join('supabase', '.temp');
const [mode, approval, runArg] = process.argv.slice(2);
if (approval !== '--allow-live' || !['--prepare', '--finish'].includes(mode) ||
    (mode === '--prepare' && runArg !== undefined) ||
    (mode === '--finish' && !UUID.test(runArg ?? ''))) {
  console.error('Usage: --prepare --allow-live OR --finish --allow-live <run-id>.');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const httpBase = process.env.P2_AGENT_HTTP_BASE_URL;
let parsedUrl;
try { parsedUrl = new URL(url); } catch { /* fail closed */ }
if (parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${PROJECT_REF}.supabase.co` ||
    !publicKey || !serviceKey || (mode === '--prepare' && httpBase !== 'http://127.0.0.1:3100')) {
  console.error(`Refusing live run: require complete credentials for ${PROJECT_REF}.supabase.co and local HTTP port 3100.`);
  process.exit(2);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const runId = mode === '--finish' ? runArg : randomUUID();
const manifestPath = join(TEMP, `p2-agent-provider-${runId}.json`);
const sqlPath = join(TEMP, `p2-agent-provider-${runId}-cleanup.sql`);
const manifest = mode === '--finish' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
  projectRef: PROJECT_REF, runId, status: 'PREPARING',
  users: [], deletedUsers: [], profiles: [], memberships: [],
};
for (const key of ['users', 'deletedUsers', 'profiles', 'memberships']) {
  if (!Array.isArray(manifest[key])) throw new Error('Invalid cleanup manifest');
}
if (manifest.projectRef !== PROJECT_REF || manifest.runId !== runId) throw new Error('Invalid cleanup manifest');
function uuid(value) {
  if (!UUID.test(value ?? '')) throw new Error('Invalid fixture UUID');
  return value;
}
function data(result, label) {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  return result.data;
}
function cleanupSql() {
  const lines = [
    '-- Exact-ID P2 live provider fixture cleanup, confirmed Test project only.',
    `-- Project ${PROJECT_REF}; run ${uuid(runId)}. Execute atomically.`,
    'begin;',
  ];
  for (const m of [...manifest.memberships].reverse())
    lines.push(`delete from public.workspace_memberships where workspace_id = '${uuid(m.workspaceId)}'::uuid and profile_id = '${uuid(m.profileId)}'::uuid;`);
  for (const p of [...manifest.profiles].reverse())
    lines.push(`delete from public.profiles where id = '${uuid(p.id)}'::uuid and auth_user_id = '${uuid(p.authUserId)}'::uuid and display_name = 'P2 agent provider ${uuid(runId)}';`);
  for (const p of manifest.profiles)
    lines.push(`do $$ begin if exists (select 1 from public.profiles where id = '${uuid(p.id)}'::uuid) then raise exception 'P2 agent profile remains'; end if; end $$;`);
  lines.push('commit;');
  lines.push(`-- Then: node scripts/p2-live-agent-provider.mjs --finish --allow-live ${uuid(runId)}`);
  return lines.join('\n') + '\n';
}
function save() {
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(sqlPath, cleanupSql());
}
function track(key, value) { manifest[key].push(value); save(); }

async function prepare() {
  if (existsSync(manifestPath)) throw new Error('Manifest already exists');
  save();
  const demo = data(await admin.from('workspaces').select('id,kind').eq('kind', 'DEMO').single(), 'Demo workspace');
  uuid(demo.id);
  const orderCount = await admin.from('workspace_orders').select('id', { count: 'exact', head: true })
    .eq('workspace_id', demo.id);
  if (orderCount.error || orderCount.count !== 0) {
    throw new Error('Demo must contain zero orders before this fictional-data-only provider check');
  }
  const email = `p2-agent-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const user = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create temporary Auth user').user;
  uuid(user?.id);
  track('users', user.id);
  const profileId = randomUUID();
  track('profiles', { id: profileId, authUserId: user.id });
  data(await admin.from('profiles').insert({
    id: profileId, auth_user_id: user.id, display_name: `P2 agent provider ${runId}`,
    role: 'ADMIN', platform_role: 'USER', active: true,
  }).select('id').single(), 'create temporary profile');
  track('memberships', { workspaceId: demo.id, profileId });
  data(await admin.from('workspace_memberships').insert({
    workspace_id: demo.id, profile_id: profileId, role: 'ADMIN', active: true,
  }).select('profile_id').single(), 'create temporary membership');
  const client = createClient(url, publicKey, options);
  const session = data(await client.auth.signInWithPassword({ email, password }), 'sign in temporary actor');
  if (session.user?.id !== user.id || !session.session?.access_token) throw new Error('Temporary actor JWT missing');
  const jar = new Map();
  const ssr = createServerClient(url, publicKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: entries => entries.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
    },
  });
  data(await ssr.auth.setSession({
    access_token: session.session.access_token, refresh_token: session.session.refresh_token,
  }), 'prepare HTTP session');
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const target = `${httpBase}/api/workspaces/${demo.id}/agent/orders`;
  const response = await fetch(target, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { Cookie: cookie, Origin: httpBase, 'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '203.0.113.2' },
    body: JSON.stringify({ question: 'Read the recent orders once and summarize the count.' }),
  });
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  if (response.status === 200) {
    const body = await response.json();
    if (!Array.isArray(body.orders) || typeof body.answer !== 'string' ||
        !/^Found \d+ recent orders? in this workspace\.$|^No recent orders were found in this workspace\.$/.test(body.answer)) {
      throw new Error('HTTP 200 but deterministic tool evidence contract invalid');
    }
    console.log(`PASS one real provider HTTP request; bounded order tool returned ${body.orders.length} rows.`);
  } else {
    console.log(`BLOCKED live provider HTTP request returned status ${response.status}; no mock result counted as live.`);
    process.exitCode = 1;
  }
  console.log(`Execute exact-ID cleanup SQL via confirmed Test connector: ${sqlPath}`);
  console.log(`After SQL succeeds, run: node scripts/p2-live-agent-provider.mjs --finish --allow-live ${runId}`);
}
async function finish() {
  if (manifest.status !== 'NEEDS_SQL_CLEANUP') throw new Error('Manifest is not ready for cleanup');
  const profileIds = manifest.profiles.map(p => uuid(p.id));
  if (profileIds.length) {
    const remaining = data(await admin.from('profiles').select('id').in('id', profileIds), 'verify SQL profile cleanup');
    if (remaining.length) throw new Error('SQL cleanup incomplete: temporary profiles remain');
  }
  for (const id of manifest.users) {
    if (manifest.deletedUsers.includes(id)) continue;
    const { error } = await admin.auth.admin.deleteUser(uuid(id));
    if (error) throw new Error(`Auth cleanup failed: ${error.code ?? error.status ?? 'UNKNOWN'}`);
    manifest.deletedUsers.push(id); save();
  }
  manifest.status = 'CLEANED'; save();
  console.log(`PASS temporary Auth user removed for P2 provider run ${runId}.`);
}
try {
  if (mode === '--prepare') await prepare(); else await finish();
} catch (error) {
  if (mode === '--prepare') {
    manifest.status = 'NEEDS_SQL_CLEANUP';
    try { save(); } catch { /* keep original error */ }
  }
  console.error(`FAIL P2 live provider: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; exact-ID cleanup SQL: ${sqlPath}`);
  process.exitCode = 1;
}
