// One-shot MCP -> authenticated Web preview check. It NEVER approves or executes.
// Run only against the confirmed fictional Demo workspace on local port 3100.
// Prepare: P5_MCP_HTTP_BASE_URL=http://127.0.0.1:3100 node scripts/p5-live-mcp-handoff.mjs --prepare --allow-live
// Execute generated exact-ID SQL via the trusted Supabase SQL connector.
// Finish: node scripts/p5-live-mcp-handoff.mjs --finish --allow-live <run-id>
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const REF = 'qobhjvrrpajoyvlgrkbx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [mode, approval, requestedRun] = process.argv.slice(2);
if (approval !== '--allow-live' || !['--prepare', '--finish'].includes(mode) ||
    (mode === '--prepare' && requestedRun) || (mode === '--finish' && !UUID.test(requestedRun ?? ''))) {
  throw new Error('Use --prepare --allow-live or --finish --allow-live <run-id>');
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = process.env.P5_MCP_HTTP_BASE_URL;
if (url !== `https://${REF}.supabase.co` || !anonKey || !serviceKey ||
    (mode === '--prepare' && base !== 'http://127.0.0.1:3100')) {
  throw new Error('Confirmed Test project credentials and local port 3100 required');
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = mode === '--finish' ? requestedRun : randomUUID();
const temp = join('supabase', '.temp');
const manifestPath = join(temp, `p5-handoff-${runId}.json`);
const sqlPath = join(temp, `p5-handoff-${runId}-cleanup.sql`);
const manifest = mode === '--finish' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
  ref: REF, runId, status: 'PREPARING', users: [], deletedUsers: [],
  profiles: [], memberships: [], branches: [], customers: [], technicians: [], orders: [], proposals: [],
};
if (manifest.ref !== REF || manifest.runId !== runId) throw new Error('Wrong fixture manifest');
for (const key of ['users', 'deletedUsers', 'profiles', 'memberships', 'branches', 'customers', 'technicians', 'orders', 'proposals']) {
  if (!Array.isArray(manifest[key])) throw new Error(`Invalid fixture ${key}`);
}
function uuid(id) { if (!UUID.test(id ?? '')) throw new Error('Invalid fixture ID'); return id; }
function data(result, label) {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  return result.data;
}
function check(ok, label) { if (!ok) throw new Error(`${label}: unexpected result`); console.log(`PASS ${label}`); }
function cleanupSql() {
  const lines = [`-- Exact-ID fictional MCP handoff fixture, confirmed Test project ${REF}, run ${uuid(runId)}.`, 'begin;'];
  for (const p of manifest.proposals) {
    lines.push(`do $$ begin if not exists (select 1 from public.workspace_assignment_proposal_audit where workspace_id = '${uuid(p.workspaceId)}' and proposal_id = '${uuid(p.id)}' and event_type = 'PROPOSED' and source_client = 'MCP') then raise exception 'MCP proposed audit missing'; end if; end $$;`);
    lines.push(`do $$ begin if exists (select 1 from public.workspace_assignment_proposal_audit where workspace_id = '${uuid(p.workspaceId)}' and proposal_id = '${uuid(p.id)}' and event_type in ('APPROVED','EXECUTED')) then raise exception 'Unexpected proposal approval'; end if; end $$;`);
    lines.push(`delete from public.workspace_assignment_proposal_audit where workspace_id = '${uuid(p.workspaceId)}' and proposal_id = '${uuid(p.id)}';`);
    lines.push(`delete from public.workspace_assignment_proposals where workspace_id = '${uuid(p.workspaceId)}' and id = '${uuid(p.id)}' and status = 'PENDING' and initiated_by_profile_id = '${uuid(p.profileId)}';`);
  }
  for (const o of manifest.orders) lines.push(`delete from public.workspace_orders where workspace_id = '${uuid(o.workspaceId)}' and id = '${uuid(o.id)}' and order_no = 'P5-HANDOFF-${uuid(runId)}';`);
  for (const t of manifest.technicians) lines.push(`delete from public.workspace_technicians where workspace_id = '${uuid(t.workspaceId)}' and id = '${uuid(t.id)}' and profile_id = '${uuid(t.profileId)}';`);
  for (const c of manifest.customers) lines.push(`delete from public.workspace_customers where workspace_id = '${uuid(c.workspaceId)}' and id = '${uuid(c.id)}';`);
  for (const b of manifest.branches) lines.push(`delete from public.workspace_branches where workspace_id = '${uuid(b.workspaceId)}' and id = '${uuid(b.id)}' and code = 'P5-HANDOFF-${uuid(runId)}';`);
  for (const m of manifest.memberships) lines.push(`delete from public.workspace_memberships where workspace_id = '${uuid(m.workspaceId)}' and profile_id = '${uuid(m.profileId)}';`);
  for (const p of manifest.profiles) lines.push(`delete from public.profiles where id = '${uuid(p.id)}' and auth_user_id = '${uuid(p.authUserId)}' and display_name = 'P5 handoff ${uuid(runId)}';`);
  for (const p of manifest.proposals) lines.push(`do $$ begin if exists (select 1 from public.workspace_assignment_proposals where workspace_id = '${uuid(p.workspaceId)}' and id = '${uuid(p.id)}') then raise exception 'Proposal remains'; end if; end $$;`);
  for (const o of manifest.orders) lines.push(`do $$ begin if exists (select 1 from public.workspace_orders where workspace_id = '${uuid(o.workspaceId)}' and id = '${uuid(o.id)}') then raise exception 'Order remains'; end if; end $$;`);
  for (const p of manifest.profiles) lines.push(`do $$ begin if exists (select 1 from public.profiles where id = '${uuid(p.id)}') then raise exception 'Profile remains'; end if; end $$;`);
  lines.push('commit;');
  return lines.join('\n') + '\n';
}
function save() { mkdirSync(temp, { recursive: true }); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n'); writeFileSync(sqlPath, cleanupSql()); }
function track(key, value) { manifest[key].push(value); save(); }
async function insert(table, workspaceId, payload, key, extra = {}) {
  const id = randomUUID();
  track(key, { id, workspaceId, ...extra });
  data(await admin.from(table).insert({ workspace_id: workspaceId, id, ...payload }).select('id').single(), `insert ${table}`);
  return id;
}
async function user(role, workspaceId) {
  const email = `p5-handoff-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const authUser = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create temporary user').user;
  uuid(authUser?.id); track('users', authUser.id);
  const profileId = randomUUID();
  track('profiles', { id: profileId, authUserId: authUser.id });
  data(await admin.from('profiles').insert({ id: profileId, auth_user_id: authUser.id,
    display_name: `P5 handoff ${runId}`, role, platform_role: 'USER', active: true }).select('id').single(), 'insert profile');
  track('memberships', { workspaceId, profileId });
  data(await admin.from('workspace_memberships').insert({ workspace_id: workspaceId, profile_id: profileId,
    role, active: true }).select('profile_id').single(), 'insert membership');
  const signed = data(await createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    .auth.signInWithPassword({ email, password }), 'sign in temporary actor');
  if (signed.user?.id !== authUser.id || !signed.session?.access_token) throw new Error('Temporary JWT missing');
  const jar = new Map();
  const ssr = createServerClient(url, anonKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: entries => entries.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)) },
  });
  data(await ssr.auth.setSession({ access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token }), 'build temporary Web session');
  return { profileId, authUserId: authUser.id, jwt: signed.session.access_token,
    cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
}
async function prepare() {
  if (existsSync(manifestPath)) throw new Error('Fixture already exists');
  save();
  const demo = data(await admin.from('workspaces').select('id,generation').eq('kind', 'DEMO').single(), 'Demo lookup');
  uuid(demo.id);
  const adminActor = await user('ADMIN', demo.id);
  const techActor = await user('TECHNICIAN', demo.id);
  const branchId = await insert('workspace_branches', demo.id, { code: `P5-HANDOFF-${runId}`, name: 'Fictional handoff branch' }, 'branches');
  const customerId = await insert('workspace_customers', demo.id, { name: 'Fictional handoff customer', address: 'Fictional handoff address' }, 'customers');
  const technicianId = await insert('workspace_technicians', demo.id, { profile_id: techActor.profileId, branch_id: branchId }, 'technicians', { profileId: techActor.profileId });
  const orderNo = `P5-HANDOFF-${runId}`;
  let order;
  try {
    order = data(await createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false },
      accessToken: async () => adminActor.jwt }).rpc('workspace_order_create', {
      p_workspace_id: demo.id, p_expected_generation: demo.generation,
      p_order_no: orderNo, p_branch_id: branchId, p_customer_id: customerId,
      p_problem_description: 'Fictional MCP handoff check', p_service_type: 'Fictional service',
    }), 'create temporary order');
  } finally {
    const found = await admin.from('workspace_orders').select('id').eq('workspace_id', demo.id).eq('order_no', orderNo).maybeSingle();
    const id = found.data?.id ?? order?.id;
    if (id) track('orders', { id: uuid(id), workspaceId: demo.id });
  }
  const client = new Client({ name: 'sejuk-ops-handoff-check', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', base), {
    requestInit: { headers: { Authorization: `Bearer ${adminActor.jwt}`, Origin: base } },
  });
  const key = randomUUID();
  let proposal;
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'assignment_propose', arguments: {
      workspaceId: demo.id, orderId: order.id, technicianId,
      expectedUpdatedAt: order.updated_at, scheduledAt: null, idempotencyKey: key,
    } });
    check(!response.isError, 'official SDK accepts bounded assignment proposal');
    const text = response.content?.find(part => part.type === 'text')?.text;
    proposal = JSON.parse(text ?? 'null');
  } finally {
    await client.close();
    const found = await admin.from('workspace_assignment_proposals').select('id')
      .eq('workspace_id', demo.id).eq('initiated_by_profile_id', adminActor.profileId)
      .eq('idempotency_key', key).maybeSingle();
    const id = found.data?.id ?? proposal?.proposal?.id;
    if (id) track('proposals', { id: uuid(id), workspaceId: demo.id, profileId: adminActor.profileId });
  }
  const path = `/workspaces/${demo.id}/assignment?proposalId=${proposal.proposal.id}`;
  check(proposal.confirmationPath === path && proposal.requiresWebConfirmation === true &&
    proposal.proposal.status === 'PENDING', 'MCP returns exact Web handoff without approval');
  const endpoint = `${base}/api/workspaces/${demo.id}/assignment-proposals/${proposal.proposal.id}`;
  const anonymous = await fetch(endpoint);
  check(anonymous.status === 403, 'Web preview denies unauthenticated request');
  const preview = await fetch(endpoint, { headers: { Cookie: adminActor.cookie }, redirect: 'manual' });
  const body = preview.status === 200 ? await preview.json() : null;
  check(preview.status === 200 && body?.proposal?.id === proposal.proposal.id &&
    body.proposal.canonicalPayload.orderId === order.id &&
    body.proposal.canonicalPayload.technicianId === technicianId &&
    /^[a-f0-9]{64}$/.test(body.previewToken), 'Web resolves initiator and persisted canonical preview');
  const noOrigin = await fetch(endpoint, { method: 'POST', headers: { Cookie: adminActor.cookie,
    'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, previewToken: body.previewToken }) });
  check(noOrigin.status === 403, 'Web confirmation denies missing Origin');
  const forged = await fetch(endpoint, { method: 'POST', headers: { Cookie: adminActor.cookie,
    Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, previewToken: 'a'.repeat(64) }) });
  check(forged.status === 403, 'Web confirmation denies forged preview token');
  const pending = data(await admin.from('workspace_assignment_proposals').select('status,approval_channel,execution_source')
    .eq('workspace_id', demo.id).eq('id', proposal.proposal.id).single(), 'read proposal state');
  check(pending.status === 'PENDING' && pending.approval_channel === null && pending.execution_source === null,
    'MCP and denied requests left proposal unapproved');
  const unchanged = data(await admin.from('workspace_orders').select('assigned_technician_id')
    .eq('workspace_id', demo.id).eq('id', order.id).single(), 'read target order');
  check(unchanged.assigned_technician_id === null, 'no assignment executed without human confirmation');
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  console.log(`PASS handoff preview; no approval executed. Cleanup SQL: ${sqlPath}`);
  console.log(`Then: node scripts/p5-live-mcp-handoff.mjs --finish --allow-live ${runId}`);
}
async function finish() {
  if (manifest.status !== 'NEEDS_SQL_CLEANUP') throw new Error('SQL cleanup not ready');
  for (const p of manifest.profiles) {
    const remaining = data(await admin.from('profiles').select('id').eq('id', uuid(p.id)), 'verify profile cleanup');
    if (remaining.length) throw new Error('Temporary profile remains');
  }
  for (const id of manifest.users) {
    if (manifest.deletedUsers.includes(id)) continue;
    const { error } = await admin.auth.admin.deleteUser(uuid(id));
    if (error) throw new Error(`Auth cleanup: ${error.code ?? error.status ?? 'UNKNOWN'}`);
    manifest.deletedUsers.push(id); save();
  }
  manifest.status = 'CLEANED'; save();
  console.log(`PASS Auth users removed for MCP handoff run ${runId}`);
}
try { if (mode === '--prepare') await prepare(); else await finish(); }
catch (error) {
  if (mode === '--prepare') { manifest.status = 'NEEDS_SQL_CLEANUP'; try { save(); } catch {} }
  console.error(`FAIL MCP handoff: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; cleanup SQL: ${sqlPath}`);
  process.exitCode = 1;
}
