// One-shot P2 fixture for the confirmed Sejuk Ops Test project only.
// Prepare: node scripts/p2-live-proposal-boundaries.mjs --prepare --allow-live
// Execute generated exact-ID SQL through the trusted Supabase SQL connector.
// Finish: node scripts/p2-live-proposal-boundaries.mjs --finish --allow-live <run-id>
// Optional HTTP web confirmation: P2_HTTP_BASE_URL=http://127.0.0.1:3100.
// The generated manifest contains IDs only. Never commit it or print credentials.
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
const httpBase = process.env.P2_HTTP_BASE_URL;
let parsedUrl;
try { parsedUrl = new URL(url); } catch { /* fail closed */ }
if (parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${PROJECT_REF}.supabase.co` ||
    !publicKey || !serviceKey || (httpBase && httpBase !== 'http://127.0.0.1:3100')) {
  console.error(`Refusing live writes: require complete credentials for ${PROJECT_REF}.supabase.co.`);
  process.exit(2);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const runId = mode === '--finish' ? runArg : randomUUID();
const manifestPath = join(TEMP, `p2-boundary-${runId}.json`);
const sqlPath = join(TEMP, `p2-boundary-${runId}-cleanup.sql`);
const manifest = mode === '--finish' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
  projectRef: PROJECT_REF, runId, status: 'PREPARING',
  users: [], deletedUsers: [], profiles: [], memberships: [],
  branches: [], customers: [], technicians: [], orders: [], proposals: [],
  expectedAudit: [],
};
for (const key of ['users', 'deletedUsers', 'profiles', 'memberships',
  'branches', 'customers', 'technicians', 'orders', 'proposals', 'expectedAudit']) {
  if (!Array.isArray(manifest[key])) throw new Error('Invalid cleanup manifest');
}
if (manifest.projectRef !== PROJECT_REF || manifest.runId !== runId) throw new Error('Invalid cleanup manifest');

function uuid(value) {
  if (!UUID.test(value ?? '')) throw new Error('Invalid fixture UUID');
  return value;
}
function marker(value) {
  if (typeof value !== 'string' || !/^[a-z]{1,24}$/.test(value)) throw new Error('Invalid fixture marker');
  return value;
}
function auditEvent(value) {
  if (!['PROPOSED', 'APPROVED', 'EXECUTED', 'STALE', 'EXPIRED'].includes(value))
    throw new Error('Invalid fixture audit event');
  return value;
}
function data(result, label) {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  return result.data;
}
let checks = 0;
function check(condition, label) {
  if (!condition) throw new Error(`${label}: unexpected result`);
  checks++;
  console.log(`PASS ${label}`);
}
function denied(result, label) { check(Boolean(result.error), label); }

function cleanupSql() {
  const lines = [
    '-- Exact-ID P2 fixture and audit verification, confirmed Test project only.',
    `-- Project ${PROJECT_REF}; run ${uuid(runId)}. Execute entire file atomically.`,
    'begin;',
  ];
  for (const a of manifest.expectedAudit) {
    lines.push(`do $$ begin if not exists (select 1 from public.workspace_assignment_proposal_audit where workspace_id = '${uuid(a.workspaceId)}'::uuid and proposal_id = '${uuid(a.proposalId)}'::uuid and event_type = '${auditEvent(a.eventType)}') then raise exception 'P2 audit event missing'; end if; end $$;`);
  }
  for (const p of [...manifest.proposals].reverse()) {
    lines.push(`delete from public.workspace_assignment_proposal_audit where workspace_id = '${uuid(p.workspaceId)}'::uuid and proposal_id = '${uuid(p.id)}'::uuid;`);
    lines.push(`delete from public.workspace_assignment_proposals where workspace_id = '${uuid(p.workspaceId)}'::uuid and id = '${uuid(p.id)}'::uuid and initiated_by_profile_id = '${uuid(p.initiatorProfileId)}'::uuid;`);
  }
  for (const o of [...manifest.orders].reverse()) {
    lines.push(`delete from public.workspace_orders where workspace_id = '${uuid(o.workspaceId)}'::uuid and id = '${uuid(o.id)}'::uuid and order_no = 'P2-${uuid(runId)}-${marker(o.marker)}';`);
  }
  for (const t of [...manifest.technicians].reverse())
    lines.push(`delete from public.workspace_technicians where workspace_id = '${uuid(t.workspaceId)}'::uuid and id = '${uuid(t.id)}'::uuid and profile_id = '${uuid(t.profileId)}'::uuid;`);
  for (const c of [...manifest.customers].reverse())
    lines.push(`delete from public.workspace_customers where workspace_id = '${uuid(c.workspaceId)}'::uuid and id = '${uuid(c.id)}'::uuid;`);
  for (const b of [...manifest.branches].reverse())
    lines.push(`delete from public.workspace_branches where workspace_id = '${uuid(b.workspaceId)}'::uuid and id = '${uuid(b.id)}'::uuid and code = 'P2-${uuid(runId)}';`);
  for (const m of [...manifest.memberships].reverse())
    lines.push(`delete from public.workspace_memberships where workspace_id = '${uuid(m.workspaceId)}'::uuid and profile_id = '${uuid(m.profileId)}'::uuid;`);
  for (const p of [...manifest.profiles].reverse())
    lines.push(`delete from public.profiles where id = '${uuid(p.id)}'::uuid and auth_user_id = '${uuid(p.authUserId)}'::uuid and display_name = 'P2 temporary ${uuid(runId)}';`);
  for (const p of manifest.proposals)
    lines.push(`do $$ begin if exists (select 1 from public.workspace_assignment_proposals where workspace_id = '${uuid(p.workspaceId)}'::uuid and id = '${uuid(p.id)}'::uuid) then raise exception 'P2 cleanup proposal remains'; end if; end $$;`);
  for (const o of manifest.orders)
    lines.push(`do $$ begin if exists (select 1 from public.workspace_orders where workspace_id = '${uuid(o.workspaceId)}'::uuid and id = '${uuid(o.id)}'::uuid) then raise exception 'P2 cleanup order remains'; end if; end $$;`);
  for (const p of manifest.profiles)
    lines.push(`do $$ begin if exists (select 1 from public.profiles where id = '${uuid(p.id)}'::uuid) then raise exception 'P2 cleanup profile remains'; end if; end $$;`);
  lines.push('commit;');
  lines.push(`-- Then: node scripts/p2-live-proposal-boundaries.mjs --finish --allow-live ${uuid(runId)}`);
  return lines.join('\n') + '\n';
}
function save() {
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'w' });
  writeFileSync(sqlPath, cleanupSql(), { flag: 'w' });
}
function track(key, row) { manifest[key].push(row); save(); }

async function temporaryUser(label, role, workspaceId) {
  const email = `p2-${label}-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const user = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create Auth ${label}`).user;
  uuid(user?.id);
  track('users', user.id);
  const profileId = randomUUID();
  track('profiles', { id: profileId, authUserId: user.id });
  data(await admin.from('profiles').insert({
    id: profileId, auth_user_id: user.id, display_name: `P2 temporary ${runId}`,
    role, platform_role: 'USER', active: true,
  }).select('id').single(), `create profile ${label}`);
  track('memberships', { workspaceId, profileId });
  data(await admin.from('workspace_memberships').insert({
    workspace_id: workspaceId, profile_id: profileId, role, active: true,
  }).select('profile_id').single(), `create membership ${label}`);
  const client = createClient(url, publicKey, options);
  const session = data(await client.auth.signInWithPassword({ email, password }), `sign in ${label}`);
  check(session.user?.id === user.id && Boolean(session.session?.access_token), `${label} has own JWT`);
  let cookieHeader;
  if (httpBase) {
    const jar = new Map();
    const ssr = createServerClient(url, publicKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: entries => entries.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
      },
    });
    data(await ssr.auth.setSession({ access_token: session.session.access_token,
      refresh_token: session.session.refresh_token }), `prepare HTTP session ${label}`);
    cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  return { client, profileId, authUserId: user.id, cookieHeader };
}

async function insert(table, row, key, details = {}) {
  const id = randomUUID();
  track(key, { id, workspaceId: row.workspace_id, ...details });
  data(await admin.from(table).insert({ ...row, id }).select('id').single(), `create ${table}`);
  return id;
}
async function order(actor, workspace, branchId, customerId, marker) {
  const orderNo = `P2-${runId}-${marker}`;
  let result;
  try {
    result = data(await actor.client.rpc('workspace_order_create', {
      p_workspace_id: workspace.id, p_expected_generation: workspace.generation,
      p_order_no: orderNo, p_branch_id: branchId, p_customer_id: customerId,
      p_problem_description: 'Fictional P2 proposal check', p_service_type: 'Fictional service',
    }), `create ${marker} order`);
    return result;
  } finally {
    // Recover an exact ID even if the write committed but the network reply was lost.
    const found = await admin.from('workspace_orders').select('id')
      .eq('workspace_id', workspace.id).eq('order_no', orderNo).maybeSingle();
    const exactId = found.data?.id ?? result?.id;
    if (exactId && !manifest.orders.some(row => row.id === exactId)) {
      track('orders', { id: uuid(exactId), workspaceId: workspace.id, marker });
    }
  }
}
async function proposal(actor, workspace, target, technicianId, key = randomUUID()) {
  let result;
  try {
    result = data(await actor.client.rpc('workspace_assignment_proposal_create', {
      p_workspace_id: workspace.id, p_order_id: target.id, p_technician_id: technicianId,
      p_expected_updated_at: target.updated_at, p_scheduled_at: null, p_idempotency_key: key,
    }), 'create proposal');
    return { result, key };
  } finally {
    const found = await actor.client.from('workspace_assignment_proposals').select('id')
      .eq('workspace_id', workspace.id).eq('initiated_by_profile_id', actor.profileId)
      .eq('idempotency_key', key).maybeSingle();
    const exactId = found.data?.id ?? result?.id;
    if (exactId && !manifest.proposals.some(p => p.id === exactId)) {
      track('proposals', { id: uuid(exactId), workspaceId: workspace.id, initiatorProfileId: actor.profileId });
      track('expectedAudit', { proposalId: exactId, workspaceId: workspace.id, eventType: 'PROPOSED' });
    }
  }
}
async function webConfirm(actor, workspace, p) {
  const endpoint = `${httpBase}/api/workspaces/${workspace.id}/assignment-proposals/${p.id}`;
  const headers = { Cookie: actor.cookieHeader };
  const preview = await fetch(endpoint, { headers, redirect: 'manual' });
  const previewBody = preview.status === 200 ? await preview.json() : null;
  check(preview.status === 200 && previewBody.proposal?.id === p.id &&
    previewBody.proposal?.canonicalPayload.technicianId === p.canonical_payload.technicianId &&
    /^[a-f0-9]{64}$/.test(previewBody.previewToken), 'HTTP preview is persisted canonical proposal');
  const deniedConfirm = await fetch(endpoint, {
    method: 'POST', headers: { ...headers, Origin: httpBase, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true, previewToken: 'a'.repeat(64) }), redirect: 'manual',
  });
  check(deniedConfirm.status === 403, 'HTTP forged preview token denied');
  const confirmed = await fetch(endpoint, {
    method: 'POST', headers: { ...headers, Origin: httpBase, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true, previewToken: previewBody.previewToken }), redirect: 'manual',
  });
  const body = confirmed.status === 200 ? await confirmed.json() : null;
  check(confirmed.status === 200 && body.proposal?.status === 'EXECUTED',
    'HTTP authenticated confirmation route approves and executes');
}

async function prepare() {
  if (existsSync(manifestPath)) throw new Error('Manifest already exists');
  save();
  const demo = data(await admin.from('workspaces').select('id,generation').eq('kind', 'DEMO').single(), 'Demo workspace');
  uuid(demo.id);
  const owner = data(await admin.from('workspaces').select('id,generation').eq('kind', 'OWNER').single(), 'Owner workspace');
  uuid(owner.id);
  check(demo.id !== owner.id, 'Demo and Owner workspaces remain distinct');
  const demoAdmin = await temporaryUser('demo-admin', 'ADMIN', demo.id);
  const demoTech = await temporaryUser('demo-tech', 'TECHNICIAN', demo.id);
  const ownerAdmin = await temporaryUser('owner-admin', 'ADMIN', owner.id);
  const ownerTech = await temporaryUser('owner-tech', 'TECHNICIAN', owner.id);
  const demoBranch = await insert('workspace_branches', {
    workspace_id: demo.id, code: `P2-${runId}`, name: 'P2 fictional Demo branch',
  }, 'branches');
  const ownerBranch = await insert('workspace_branches', {
    workspace_id: owner.id, code: `P2-${runId}`, name: 'P2 fictional Owner branch',
  }, 'branches');
  const demoCustomer = await insert('workspace_customers', {
    workspace_id: demo.id, name: 'P2 fictional customer', address: 'P2 fictional address',
  }, 'customers');
  const ownerCustomer = await insert('workspace_customers', {
    workspace_id: owner.id, name: 'P2 fictional owner customer', address: 'P2 fictional address',
  }, 'customers');
  const demoTechnician = await insert('workspace_technicians', {
    workspace_id: demo.id, profile_id: demoTech.profileId, branch_id: demoBranch,
  }, 'technicians', { profileId: demoTech.profileId });
  const ownerTechnician = await insert('workspace_technicians', {
    workspace_id: owner.id, profile_id: ownerTech.profileId, branch_id: ownerBranch,
  }, 'technicians', { profileId: ownerTech.profileId });
  const mainOrder = await order(demoAdmin, demo, demoBranch, demoCustomer, 'main');
  const staleOrder = await order(demoAdmin, demo, demoBranch, demoCustomer, 'stale');
  const ownerOrder = await order(ownerAdmin, owner, ownerBranch, ownerCustomer, 'owner');
  const main = await proposal(demoAdmin, demo, mainOrder, demoTechnician);
  check(main.result.status === 'PENDING' && main.result.canonical_payload?.technicianId === demoTechnician,
    'proposal stores concrete canonical assignment');
  const retry = await proposal(demoAdmin, demo, mainOrder, demoTechnician, main.key);
  check(retry.result.id === main.result.id, 'create retry is idempotent');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_create', {
    p_workspace_id: demo.id, p_order_id: staleOrder.id, p_technician_id: demoTechnician,
    p_expected_updated_at: staleOrder.updated_at, p_scheduled_at: null,
    p_idempotency_key: main.key,
  }), 'same idempotency key with changed target denied');
  denied(await demoTech.client.rpc('workspace_assignment_proposal_create', {
    p_workspace_id: demo.id, p_order_id: mainOrder.id, p_technician_id: demoTechnician,
    p_expected_updated_at: mainOrder.updated_at, p_scheduled_at: null,
    p_idempotency_key: randomUUID(),
  }), 'Technician cannot create proposal');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_create', {
    p_workspace_id: owner.id, p_order_id: ownerOrder.id, p_technician_id: ownerTechnician,
    p_expected_updated_at: ownerOrder.updated_at, p_scheduled_at: null,
    p_idempotency_key: randomUUID(),
  }), 'Demo actor cannot create Owner proposal');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_approve', {
    p_workspace_id: demo.id, p_proposal_id: main.result.id,
    p_approver_auth_user_id: demoAdmin.authUserId,
  }), 'ordinary JWT cannot self-approve');
  denied(await demoTech.client.rpc('workspace_assignment_proposal_execute', {
    p_workspace_id: demo.id, p_proposal_id: main.result.id,
  }), 'Technician cannot execute proposal');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_execute', {
    p_workspace_id: demo.id, p_proposal_id: main.result.id,
  }), 'unapproved proposal cannot execute');
  denied(await demoAdmin.client.from('workspace_assignment_proposals').update({ status: 'APPROVED' })
    .eq('workspace_id', demo.id).eq('id', main.result.id), 'direct proposal status mutation denied');
  const stale = await proposal(demoAdmin, demo, staleOrder, demoTechnician);
  data(await demoAdmin.client.rpc('workspace_order_assign', {
    p_workspace_id: demo.id, p_expected_generation: demo.generation,
    p_order_id: staleOrder.id, p_technician_id: demoTechnician,
    p_expected_updated_at: staleOrder.updated_at, p_scheduled_at: null,
  }), 'mutate stale target');
  const staleApproval = data(await admin.rpc('workspace_assignment_proposal_approve', {
    p_workspace_id: demo.id, p_proposal_id: stale.result.id,
    p_approver_auth_user_id: demoAdmin.authUserId,
  }), 'approve stale version');
  check(staleApproval.status === 'STALE', 'changed target cannot be approved');
  track('expectedAudit', { proposalId: stale.result.id, workspaceId: demo.id, eventType: 'STALE' });
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_execute', {
    p_workspace_id: demo.id, p_proposal_id: stale.result.id,
  }), 'stale proposal cannot execute');

  const ownerProposal = await proposal(ownerAdmin, owner, ownerOrder, ownerTechnician);
  const ownerRead = data(await ownerAdmin.client.from('workspace_assignment_proposals').select('id'), 'Owner proposal read');
  const demoRead = data(await demoAdmin.client.from('workspace_assignment_proposals').select('id'), 'Demo proposal read');
  check(ownerRead.some(p => p.id === ownerProposal.result.id) && !ownerRead.some(p => p.id === main.result.id)
    && demoRead.some(p => p.id === main.result.id) && !demoRead.some(p => p.id === ownerProposal.result.id),
    'proposal RLS keeps Demo and Owner separate');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_execute', {
    p_workspace_id: owner.id, p_proposal_id: ownerProposal.result.id,
  }), 'Demo actor cannot execute Owner proposal');
  console.log('SKIP proposal generation turnover: preserve existing Owner/Demo generation; cover through isolated reset gate.');

  if (httpBase) {
    await webConfirm(demoAdmin, demo, main.result);
  } else {
    console.log('SKIP HTTP human preview/confirm: P2_HTTP_BASE_URL not configured.');
    const approved = data(await admin.rpc('workspace_assignment_proposal_approve', {
      p_workspace_id: demo.id, p_proposal_id: main.result.id,
      p_approver_auth_user_id: demoAdmin.authUserId,
    }), 'synthetic SQL-level approval');
    check(approved.status === 'APPROVED', 'backend approval persisted');
    const executed = data(await demoAdmin.client.rpc('workspace_assignment_proposal_execute', {
      p_workspace_id: demo.id, p_proposal_id: main.result.id,
    }), 'execute approved proposal');
    check(executed.status === 'EXECUTED', 'approved proposal executes');
  }
  track('expectedAudit', { proposalId: main.result.id, workspaceId: demo.id, eventType: 'APPROVED' });
  track('expectedAudit', { proposalId: main.result.id, workspaceId: demo.id, eventType: 'EXECUTED' });
  const after = data(await demoAdmin.client.from('workspace_orders').select('assigned_technician_id,updated_at')
    .eq('workspace_id', demo.id).eq('id', mainOrder.id).single(), 'read assigned target');
  check(after.assigned_technician_id === demoTechnician && after.updated_at !== mainOrder.updated_at,
    'only canonical technician applied to target');
  const repeat = data(await demoAdmin.client.rpc('workspace_assignment_proposal_execute', {
    p_workspace_id: demo.id, p_proposal_id: main.result.id,
  }), 'duplicate execute');
  check(repeat.status === 'EXECUTED', 'duplicate execution returns durable result');
  const afterRetry = data(await demoAdmin.client.from('workspace_orders').select('updated_at')
    .eq('workspace_id', demo.id).eq('id', mainOrder.id).single(), 'read retry target');
  check(afterRetry.updated_at === after.updated_at, 'duplicate execution causes no second write');
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  console.log(`PASS ${checks} live checks. Execute exact-ID SQL via confirmed Test connector: ${sqlPath}`);
  console.log(`After SQL succeeds, run: node scripts/p2-live-proposal-boundaries.mjs --finish --allow-live ${runId}`);
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
  console.log(`PASS temporary Auth users removed for P2 run ${runId}.`);
}

try {
  if (mode === '--prepare') await prepare(); else await finish();
} catch (error) {
  if (mode === '--prepare') {
    manifest.status = 'NEEDS_SQL_CLEANUP';
    try { save(); } catch { /* report original error */ }
  }
  console.error(`FAIL P2 live boundary: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; exact-ID cleanup SQL: ${sqlPath}`);
  process.exitCode = 1;
}
