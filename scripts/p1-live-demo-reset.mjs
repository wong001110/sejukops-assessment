// One-shot integration fixture for the confirmed Sejuk Ops Test project.
// This is destructive to the Demo workspace. It is deliberately NOT invoked
// by tests, build, or migrations. Run only after all P1/P2/P3 reset-dependent
// migrations are applied and the Demo workspace is empty.
// Usage: node scripts/p1-live-demo-reset.mjs --allow-live-demo-reset
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
if (process.argv.length !== 3 || process.argv[2] !== '--allow-live-demo-reset') {
  console.error('Refusing Demo reset: pass exactly --allow-live-demo-reset.');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let parsed;
try { parsed = new URL(url); } catch { /* fail closed */ }
if (parsed?.protocol !== 'https:' || parsed.hostname !== `${PROJECT_REF}.supabase.co`
    || !publicKey || !serviceKey) {
  console.error(`Refusing Demo reset: require credentials for ${PROJECT_REF}.supabase.co.`);
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, opts);
const runId = randomUUID();
const password = randomBytes(36).toString('base64url');
const suffix = randomBytes(8).toString('hex');
const made = { users: [], profiles: [], memberships: [], ownerBranch: null,
  demoCustomer: null, demoOrder: null, demoTechnician: null,
  demoTechProfile: null, knowledgeDocument: null, proposal: null };
let demo;
let owner;
let didReset = false;
let checks = 0;
let cleanupErrors = 0;

function need(result, label) {
  if (result.error || result.data == null) {
    throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  }
  return result.data;
}
function check(ok, label) {
  if (!ok) throw new Error(`${label}: unexpected result`);
  checks++;
  console.log(`PASS ${label}`);
}
function denied(result, label) { check(Boolean(result.error), label); }
async function inventory() {
  return need(await service.rpc('demo_reset_inventory'), 'service-only Demo inventory');
}
async function actor(label, role, workspaceId, platformRole = 'USER') {
  const email = `p1-reset-${label}-${suffix}@example.invalid`;
  const user = need(await service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${label} Auth`).user;
  if (!user?.id) throw new Error(`create ${label} Auth: NO_USER`);
  made.users.push(user.id);
  const profileId = randomUUID();
  need(await service.from('profiles').insert({ id: profileId, auth_user_id: user.id,
    display_name: `P1 reset fixture ${runId}`, role, platform_role: platformRole, active: true })
    .select('id').single(), `create ${label} profile`);
  made.profiles.push(profileId);
  need(await service.from('workspace_memberships').insert({ workspace_id: workspaceId,
    profile_id: profileId, role, active: true }).select('profile_id').single(), `create ${label} membership`);
  made.memberships.push({ workspace_id: workspaceId, profile_id: profileId });
  const client = createClient(url, publicKey, opts);
  const session = need(await client.auth.signInWithPassword({ email, password }), `sign in ${label}`);
  check(session.user?.id === user.id && Boolean(session.session?.access_token), `${label} JWT`);
  return { userId: user.id, profileId, client, accessToken: session.session.access_token };
}
async function exactDelete(table, id, workspaceId) {
  let query = service.from(table).delete().eq('id', id);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { error } = await query;
  if (error) throw error;
}
async function cleanup() {
  // If the main reset did not complete, retry only because preflight proved
  // Demo had no business data before these exact temporary fixtures.
  if (!didReset && demo && made.demoCustomer) {
    try {
      const current = need(await service.from('workspaces').select('generation')
        .eq('id', demo.id).single(), 'cleanup generation');
      need(await service.rpc('demo_reset', { p_actor_auth_user_id: made.users[0],
        p_expected_generation: current.generation }), 'cleanup Demo reset');
      didReset = true;
      console.log('CLEANUP Demo fixture reset complete');
    } catch (error) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED Demo fixtures: ${error?.message ?? 'UNKNOWN'}`);
    }
  }
  const actions = [];
  if (made.ownerBranch) actions.push(['Owner sentinel branch', () => exactDelete('workspace_branches', made.ownerBranch, owner.id)]);
  if (!didReset && demo) {
    // Best effort for early failures before P2/P3 fixtures. The DB reset above
    // is needed once those definer-only rows exist.
    if (made.demoOrder) actions.push(['Demo order', () => exactDelete('workspace_orders', made.demoOrder, demo.id)]);
    if (made.demoTechnician) actions.push(['Demo technician', () => exactDelete('workspace_technicians', made.demoTechnician, demo.id)]);
    if (made.demoCustomer) actions.push(['Demo customer', () => exactDelete('workspace_customers', made.demoCustomer, demo.id)]);
  }
  for (const [label, action] of actions) {
    try { await action(); } catch (error) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED ${label}: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
  // The applied reset intentionally retains permanent Demo memberships and
  // recreates a Technician mapping on the new fictional branch.
  if (made.demoTechProfile && demo) {
    try {
      const { error } = await service.from('workspace_technicians').delete()
        .eq('workspace_id', demo.id).eq('profile_id', made.demoTechProfile);
      if (error) throw error;
    } catch (error) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED remapped Demo technician: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
  for (const item of [...made.memberships].reverse()) {
    try {
      const { error } = await service.from('workspace_memberships').delete()
        .eq('workspace_id', item.workspace_id).eq('profile_id', item.profile_id);
      if (error) throw error;
    } catch (error) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED membership ${item.profile_id}: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
  for (const id of [...made.profiles].reverse()) {
    try { await exactDelete('profiles', id); } catch (error) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED profile ${id}: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
  for (const id of [...made.users].reverse()) {
    try {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) throw error;
    } catch (error) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED Auth user ${id}: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
  for (const id of made.profiles) {
    const { count, error } = await service.from('profiles')
      .select('id', { count: 'exact', head: true }).eq('id', id);
    if (error || count !== 0) {
      cleanupErrors++;
      console.error(`CLEANUP FAILED profile verification ${id}: ${error?.code ?? 'STILL_PRESENT'}`);
    }
  }
  if (cleanupErrors) {
    console.error(`MANUAL CLEANUP project=${PROJECT_REF} run=${runId} Demo=${demo?.id ?? 'none'} Owner=${owner?.id ?? 'none'} ` +
      `profiles=${made.profiles.join(',')} users=${made.users.join(',')} proposal=${made.proposal ?? 'none'} ` +
      `knowledge=${made.knowledgeDocument ?? 'none'} OwnerBranch=${made.ownerBranch ?? 'none'}`);
  }
}

let failed = false;
try {
  demo = need(await service.from('workspaces').select('id,generation').eq('kind', 'DEMO').eq('active', true).single(), 'Demo workspace');
  owner = need(await service.from('workspaces').select('id,generation').eq('kind', 'OWNER').eq('active', true).single(), 'Owner workspace');
  check(demo.id !== owner.id, 'distinct Demo and Owner workspaces');
  const initialInventory = await inventory();
  const emptyFields = ['orders', 'technicians', 'customers', 'memberships',
    'proposals', 'proposalAudit', 'knowledgeDocuments', 'knowledgeVersions', 'knowledgeChunks'];
  check(initialInventory.workspaceId === demo.id && initialInventory.generation === demo.generation,
    'inventory matches Demo workspace');
  for (const field of emptyFields) check(initialInventory[field] === 0, `empty Demo ${field} preflight`);
  const branches = need(await service.from('workspace_branches').select('id,code,name,address')
    .eq('workspace_id', demo.id), 'Demo branches');
  check(branches.length === 1 && branches[0].code === 'DEMO-HQ', 'only fictional Demo branch preflight');
  const beforeConfig = need(await service.from('ai_provider_configs').select('id,updated_at').order('id'), 'platform config snapshot');

  const superAdmin = await actor('superadmin', 'ADMIN', owner.id, 'SUPER_ADMIN');
  const demoAdmin = await actor('demo-admin', 'ADMIN', demo.id);
  const demoTech = await actor('demo-tech', 'TECHNICIAN', demo.id);
  made.demoTechProfile = demoTech.profileId;
  denied(await demoAdmin.client.rpc('demo_reset_inventory'), 'ordinary JWT cannot read reset inventory');
  const ownerSentinelId = randomUUID();
  made.ownerBranch = ownerSentinelId;
  need(await service.from('workspace_branches').insert({ workspace_id: owner.id,
    id: ownerSentinelId, code: `RESET-SENTINEL-${suffix}`, name: 'Temporary Owner sentinel' })
    .select('id').single(), 'Owner sentinel');

  // Auth-disabled Demo uses permanent temporary users with Demo memberships.
  // This verifies workspace reset and stale JWT boundaries, not hosted
  // anonymous signup or CAPTCHA.
  const customerId = randomUUID(); made.demoCustomer = customerId;
  need(await service.from('workspace_customers').insert({ workspace_id: demo.id,
    id: customerId, name: 'Fictional reset customer', address: 'Fictional street' })
    .select('id').single(), 'Demo customer');
  const technicianId = randomUUID(); made.demoTechnician = technicianId;
  need(await service.from('workspace_technicians').insert({ workspace_id: demo.id,
    id: technicianId, profile_id: demoTech.profileId, branch_id: branches[0].id })
    .select('id').single(), 'Demo technician');
  const order = need(await demoAdmin.client.rpc('workspace_order_create', {
    p_workspace_id: demo.id, p_expected_generation: demo.generation,
    p_order_no: `RESET-${suffix}`, p_branch_id: branches[0].id,
    p_customer_id: customerId, p_problem_description: 'Fictional reset check',
    p_service_type: 'Fictional HVAC visit',
  }), 'Demo order');
  made.demoOrder = order.id;
  const docId = need(await demoAdmin.client.rpc('knowledge_create_document', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_title: 'Fictional reset guide', p_source_label: 'Reset fixture',
  }), 'Demo knowledge document');
  made.knowledgeDocument = docId;
  need(await demoAdmin.client.rpc('knowledge_stage_text', {
    p_workspace_id: demo.id, p_generation: demo.generation, p_document_id: docId,
    p_source_text: 'Fictional cooling system diagnosis for reset verification.',
    p_chunks: ['Fictional cooling system diagnosis for reset verification.'],
  }), 'Demo knowledge version');
  const proposal = need(await demoAdmin.client.rpc('workspace_assignment_proposal_create', {
    p_workspace_id: demo.id, p_order_id: order.id, p_technician_id: technicianId,
    p_expected_updated_at: order.updated_at, p_scheduled_at: null,
    p_idempotency_key: randomUUID(),
  }), 'Demo assignment proposal');
  made.proposal = proposal.id;
  check((await inventory()).proposalAudit === 1, 'proposal audit fixture exists');

  // Resolve the privileged actor fresh from Auth and profile, then ask the
  // database to recheck it. No browser-provided identity is accepted.
  const fresh = need(await service.auth.getUser(superAdmin.accessToken), 'fresh Auth verification').user;
  const freshProfile = need(await service.from('profiles').select('id,platform_role,active')
    .eq('auth_user_id', fresh.id).single(), 'fresh platform profile');
  check(fresh.id === superAdmin.userId && freshProfile.active && freshProfile.platform_role === 'SUPER_ADMIN',
    'fresh permanent Super Admin actor');
  denied(await demoAdmin.client.rpc('demo_reset', { p_actor_auth_user_id: superAdmin.userId,
    p_expected_generation: demo.generation }), 'ordinary JWT cannot call reset');
  denied(await service.rpc('demo_reset', { p_actor_auth_user_id: demoAdmin.userId,
    p_expected_generation: demo.generation }), 'service RPC rejects ordinary actor');
  denied(await service.rpc('demo_reset', { p_actor_auth_user_id: randomUUID(),
    p_expected_generation: demo.generation }), 'service RPC rejects invented actor');
  denied(await service.rpc('demo_reset', { p_actor_auth_user_id: superAdmin.userId,
    p_expected_generation: demo.generation + 1 }), 'service RPC rejects stale generation');
  const newGeneration = need(await service.rpc('demo_reset', {
    p_actor_auth_user_id: fresh.id, p_expected_generation: demo.generation,
  }), 'reset Demo');
  didReset = true;
  check(newGeneration === demo.generation + 1, 'generation increments once');
  const afterDemo = need(await service.from('workspaces').select('generation').eq('id', demo.id).single(), 'Demo after reset');
  check(afterDemo.generation === newGeneration, 'generation persisted');
  const finalInventory = await inventory();
  check(finalInventory.workspaceId === demo.id && finalInventory.generation === newGeneration,
    'inventory reflects the new generation');
  for (const field of emptyFields.filter(value => value !== 'memberships' && value !== 'technicians')) {
    check(finalInventory[field] === 0, `reset removed Demo ${field}`);
  }
  check(finalInventory.memberships === 2 && finalInventory.technicians === 1,
    'permanent Demo memberships and Technician mapping preserved');
  const afterBranches = need(await service.from('workspace_branches').select('code,name,address')
    .eq('workspace_id', demo.id), 'Demo branch after reset');
  check(afterBranches.length === 1 && afterBranches[0].code === 'DEMO-HQ'
    && afterBranches[0].name === 'Demo Service Hub', 'fictional Demo branch reseeded');
  const ownerSentinel = need(await service.from('workspace_branches').select('id')
    .eq('workspace_id', owner.id).eq('id', ownerSentinelId).single(), 'Owner sentinel after reset');
  check(ownerSentinel.id === ownerSentinelId, 'Owner sentinel preserved');
  const ownerAfter = need(await service.from('workspaces').select('generation')
    .eq('id', owner.id).single(), 'Owner workspace after reset');
  check(ownerAfter.generation === owner.generation, 'Owner generation preserved');
  const afterConfig = need(await service.from('ai_provider_configs').select('id,updated_at').order('id'), 'platform config after reset');
  check(JSON.stringify(afterConfig) === JSON.stringify(beforeConfig), 'platform config preserved');
  denied(await demoAdmin.client.rpc('workspace_order_create', {
    p_workspace_id: demo.id, p_expected_generation: demo.generation,
    p_order_no: `STALE-${suffix}`, p_branch_id: branches[0].id,
    p_customer_id: customerId, p_problem_description: 'Stale', p_service_type: 'Stale',
  }), 'stale order write denied');
  denied(await demoAdmin.client.rpc('knowledge_create_document', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_title: 'Stale', p_source_label: 'Stale',
  }), 'stale knowledge write denied');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_execute', {
    p_workspace_id: demo.id, p_proposal_id: proposal.id,
  }), 'stale proposal execution denied');
  denied(await demoAdmin.client.rpc('workspace_assignment_proposal_create', {
    p_workspace_id: demo.id, p_order_id: order.id, p_technician_id: technicianId,
    p_expected_updated_at: order.updated_at, p_scheduled_at: null,
    p_idempotency_key: randomUUID(),
  }), 'stale proposal creation denied');
  console.log(`PASS Demo reset verification: ${checks} checks`);
} catch (error) {
  failed = true;
  console.error(`FAIL Demo reset verification: ${error?.message ?? 'UNKNOWN'}`);
} finally {
  await cleanup();
  if (failed || cleanupErrors) process.exitCode = 1;
}
