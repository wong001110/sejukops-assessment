// Real network MCP client smoke test on the confirmed Test project, Demo only.
// Prepare: P5_MCP_HTTP_BASE_URL=http://127.0.0.1:3100 node scripts/p5-live-mcp-client.mjs --prepare --allow-live
// Execute generated exact-ID SQL through the trusted Supabase SQL connector.
// Finish: node scripts/p5-live-mcp-client.mjs --finish --allow-live <run-id>
// Manifests contain IDs only; Auth credentials and bearer tokens are never printed.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
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
const httpBase = process.env.P5_MCP_HTTP_BASE_URL;
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
const manifestPath = join(TEMP, `p5-mcp-client-${runId}.json`);
const sqlPath = join(TEMP, `p5-mcp-client-${runId}-cleanup.sql`);
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
function check(condition, label) {
  if (!condition) throw new Error(`${label}: unexpected result`);
  console.log(`PASS ${label}`);
}
function cleanupSql() {
  const lines = [
    '-- Exact-ID P5 MCP client fixture cleanup, confirmed Test project only.',
    `-- Project ${PROJECT_REF}; run ${uuid(runId)}. Execute atomically.`, 'begin;',
  ];
  for (const m of [...manifest.memberships].reverse())
    lines.push(`delete from public.workspace_memberships where workspace_id = '${uuid(m.workspaceId)}'::uuid and profile_id = '${uuid(m.profileId)}'::uuid;`);
  for (const p of [...manifest.profiles].reverse())
    lines.push(`delete from public.profiles where id = '${uuid(p.id)}'::uuid and auth_user_id = '${uuid(p.authUserId)}'::uuid and display_name = 'P5 MCP client ${uuid(runId)}';`);
  for (const p of manifest.profiles)
    lines.push(`do $$ begin if exists (select 1 from public.profiles where id = '${uuid(p.id)}'::uuid) then raise exception 'P5 MCP profile remains'; end if; end $$;`);
  lines.push('commit;');
  lines.push(`-- Then: node scripts/p5-live-mcp-client.mjs --finish --allow-live ${uuid(runId)}`);
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
  const existing = data(await admin.from('workspace_orders').select('id').eq('workspace_id', demo.id).limit(1), 'Demo order preflight');
  if (existing.length !== 0) throw new Error('Demo workspace is not empty; no MCP request sent');
  check(true, 'Demo preflight has zero orders');
  const email = `p5-mcp-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const user = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create temporary Auth user').user;
  uuid(user?.id);
  track('users', user.id);
  const profileId = randomUUID();
  track('profiles', { id: profileId, authUserId: user.id });
  data(await admin.from('profiles').insert({
    id: profileId, auth_user_id: user.id, display_name: `P5 MCP client ${runId}`,
    role: 'ADMIN', platform_role: 'USER', active: true,
  }).select('id').single(), 'create temporary profile');
  track('memberships', { workspaceId: demo.id, profileId });
  data(await admin.from('workspace_memberships').insert({
    workspace_id: demo.id, profile_id: profileId, role: 'ADMIN', active: true,
  }).select('profile_id').single(), 'create temporary Demo membership');
  const session = data(await createClient(url, publicKey, options).auth.signInWithPassword({ email, password }), 'sign in temporary actor');
  if (session.user?.id !== user.id || !session.session?.access_token) throw new Error('Temporary actor JWT missing');
  const jwtParts = session.session.access_token.split('.');
  const payload = jwtParts.length === 3 ? JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8')) : {};
  check(payload.sub === user.id && payload.role === 'authenticated' &&
    typeof payload.is_anonymous === 'boolean' && UUID.test(String(payload.session_id)),
    'JWT has expected authenticated Demo actor and UUID session claims');
  const activeBefore = data(await admin.rpc('mcp_session_active', {
    p_auth_user_id: user.id, p_session_id: payload.session_id,
  }), 'check active Auth session');
  check(activeBefore === true, 'JWT session_id matches a live auth.sessions row');
  const endpoint = new URL('/api/mcp', httpBase);
  const noBearer = await fetch(endpoint, { method: 'POST', headers: { Origin: httpBase, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(10_000) });
  check(noBearer.status === 401, 'MCP endpoint rejects missing bearer');
  const foreignOrigin = await fetch(endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${session.session.access_token}`, Origin: 'https://foreign.invalid', 'Content-Type': 'application/json',
  }, body: '{}', signal: AbortSignal.timeout(10_000) });
  check(foreignOrigin.status === 403, 'MCP endpoint rejects foreign Origin');
  const authenticatedProbe = await fetch(endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${session.session.access_token}`, Origin: httpBase, 'Content-Type': 'application/json',
  }, body: '{}', signal: AbortSignal.timeout(10_000) });
  check(authenticatedProbe.status !== 401, 'direct bearer reaches MCP handler');
  const client = new Client({ name: 'sejuk-ops-live-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${session.session.access_token}`, Origin: httpBase } },
    fetch: (input, init) => {
      if (!new Headers(init?.headers).has('authorization')) throw new Error('SDK request lost bearer header');
      return fetch(input, init);
    },
  });
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    check(catalog.tools.some(tool => tool.name === 'recent_orders'), 'real SDK client lists read tool');
    const recent = await client.callTool({ name: 'recent_orders', arguments: { workspaceId: demo.id, limit: 1 } });
    const text = recent.content?.find(item => item.type === 'text')?.text;
    const body = text ? JSON.parse(text) : null;
    check(!recent.isError && body?.workspaceId === demo.id && Array.isArray(body.orders) && body.orders.length === 0,
      'real SDK client reads zero Demo orders');
    const foreign = await client.callTool({ name: 'recent_orders', arguments: {
      workspaceId: randomUUID(), limit: 1,
    } });
    check(foreign.isError === true, 'real SDK client denies unowned workspace');
  } finally {
    await client.close();
  }
  const revoked = await admin.auth.admin.signOut(session.session.access_token, 'local');
  if (revoked.error) throw new Error(`revoke temporary Auth session: ${revoked.error.code ?? revoked.error.status ?? 'UNKNOWN'}`);
  const activeAfter = data(await admin.rpc('mcp_session_active', {
    p_auth_user_id: user.id, p_session_id: payload.session_id,
  }), 'check revoked Auth session');
  check(activeAfter === false, 'sign-out removes the matching auth.sessions row');
  const oldBearer = await fetch(endpoint, { method: 'POST', headers: {
    Authorization: `Bearer ${session.session.access_token}`, Origin: httpBase, 'Content-Type': 'application/json',
  }, body: '{}', signal: AbortSignal.timeout(10_000) });
  check(oldBearer.status === 401, 'same signed JWT is denied after session revocation');
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  console.log(`Execute exact-ID cleanup SQL via confirmed Test connector: ${sqlPath}`);
  console.log(`After SQL succeeds, run: node scripts/p5-live-mcp-client.mjs --finish --allow-live ${runId}`);
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
  console.log(`PASS temporary Auth user removed for P5 MCP run ${runId}.`);
}
try {
  if (mode === '--prepare') await prepare(); else await finish();
} catch (error) {
  if (mode === '--prepare') {
    manifest.status = 'NEEDS_SQL_CLEANUP';
    try { save(); } catch { /* retain original error */ }
  }
  console.error(`FAIL P5 MCP client: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; exact-ID cleanup SQL: ${sqlPath}`);
  process.exitCode = 1;
}
