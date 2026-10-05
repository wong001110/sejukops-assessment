// One-shot destructive integration fixture for the confirmed Sejuk Ops Test project.
// Usage: node scripts/p1-live-auth-boundaries.mjs --allow-live
// Never run this against another project or with real customer/account details.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--allow-live') {
  console.error('Refusing live writes: pass exactly --allow-live.');
  process.exit(2);
}

process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const httpBase = process.env.P1_HTTP_BASE_URL;
let parsedUrl;
try { parsedUrl = new URL(url); } catch { /* fail closed below */ }
if (parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${PROJECT_REF}.supabase.co`
    || !publicKey || !serviceKey || (httpBase && httpBase !== 'http://127.0.0.1:3100')) {
  console.error(`Refusing live writes: require complete credentials for ${PROJECT_REF}.supabase.co.`);
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const runId = randomUUID();
const suffix = randomBytes(8).toString('hex');
const password = randomBytes(36).toString('base64url');
const created = { users: [], profiles: [], memberships: [], branches: [], customers: [], technicians: [], orders: [] };
let checks = 0;
let cleanupFailures = 0;

function requireData(result, label) {
  if (result.error || !result.data) {
    throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  }
  return result.data;
}

function expect(condition, label) {
  if (!condition) throw new Error(`${label}: unexpected result`);
  checks += 1;
  console.log(`PASS ${label}`);
}

function expectDenied(result, label) {
  expect(Boolean(result.error), label);
}

async function insert(table, row, key) {
  const id = row.id ?? randomUUID();
  created[key].push({ id, workspace_id: row.workspace_id });
  const data = requireData(await admin.from(table).insert({ ...row, id }).select('id').single(), `create ${table}`);
  return data.id;
}

async function temporaryUser(label, role, workspaceId) {
  // Admin createUser does not send a confirmation email; email_confirm bypasses it.
  const email = `p1-${label}-${suffix}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user?.id) throw new Error(`create auth ${label}: ${error?.code ?? error?.status ?? 'NO_USER'}`);
  created.users.push(data.user.id);
  const profileId = await insert('profiles', {
    auth_user_id: data.user.id, display_name: `P1 temporary ${label} ${runId}`,
    role, platform_role: 'USER', active: true,
  }, 'profiles');
  created.memberships.push({ workspace_id: workspaceId, profile_id: profileId });
  requireData(await admin.from('workspace_memberships').insert({
    workspace_id: workspaceId, profile_id: profileId, role, active: true,
  }).select('profile_id').single(), `create membership ${label}`);
  const client = createClient(url, publicKey, options);
  const session = requireData(await client.auth.signInWithPassword({ email, password }), `sign in ${label}`);
  expect(session.user.id === data.user.id && Boolean(session.session?.access_token), `${label} has own JWT`);
  let cookieHeader;
  if (httpBase) {
    const jar = new Map();
    const browserSession = createServerClient(url, publicKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: entries => entries.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
      },
    });
    requireData(await browserSession.auth.setSession({
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    }), `prepare HTTP session ${label}`);
    const probe = createServerClient(url, publicKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: entries => entries.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
      },
    });
    const probeResult = await probe.auth.getUser();
    expect(probeResult.data.user?.id === data.user.id && !probeResult.error,
      `${label} SSR session resolves to its Auth user`);
    cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  return { client, profileId, cookieHeader };
}

async function cleanTable(table, rows) {
  for (const row of [...rows].reverse()) {
    try {
      let query = admin.from(table).delete().eq(row.order_no ? 'order_no' : 'id', row.order_no ?? row.id);
      if (row.workspace_id) query = query.eq('workspace_id', row.workspace_id);
      const { error } = await query;
      if (error) throw error;
    } catch (error) {
      cleanupFailures += 1;
      console.error(`CLEANUP FAILED ${table}: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
}

async function cleanup() {
  await cleanTable('workspace_orders', created.orders);
  await cleanTable('workspace_technicians', created.technicians);
  await cleanTable('workspace_customers', created.customers);
  await cleanTable('workspace_branches', created.branches);
  for (const row of [...created.memberships].reverse()) {
    try {
      const { error } = await admin.from('workspace_memberships').delete()
        .eq('workspace_id', row.workspace_id).eq('profile_id', row.profile_id);
      if (error) throw error;
    } catch (error) {
      cleanupFailures += 1;
      console.error(`CLEANUP FAILED workspace_memberships: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
  await cleanTable('profiles', created.profiles);
  for (const id of [...created.users].reverse()) {
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    } catch (error) {
      cleanupFailures += 1;
      console.error(`CLEANUP FAILED auth user: ${error?.code ?? error?.status ?? 'UNKNOWN'}`);
    }
  }
}

let failed = false;
try {
  const demo = requireData(await admin.from('workspaces').select('id,generation').eq('kind', 'DEMO').single(), 'Demo workspace');
  const owner = requireData(await admin.from('workspaces').select('id,generation').eq('kind', 'OWNER').single(), 'Owner workspace');
  expect(demo.id !== owner.id, 'distinct initial workspaces');

  const demoAdmin = await temporaryUser('demo-admin', 'ADMIN', demo.id);
  const demoTech = await temporaryUser('demo-tech', 'TECHNICIAN', demo.id);
  const ownerAdmin = await temporaryUser('owner-admin', 'ADMIN', owner.id);

  const demoBranch = await insert('workspace_branches', {
    workspace_id: demo.id, code: `P1-${suffix}`, name: `P1 temporary branch ${runId}`,
  }, 'branches');
  const ownerBranch = await insert('workspace_branches', {
    workspace_id: owner.id, code: `P1-${suffix}`, name: `P1 temporary branch ${runId}`,
  }, 'branches');
  const demoCustomer = await insert('workspace_customers', {
    workspace_id: demo.id, name: 'Fictional P1 customer', address: 'Fictional test address',
  }, 'customers');
  const ownerCustomer = await insert('workspace_customers', {
    workspace_id: owner.id, name: 'Fictional P1 customer', address: 'Fictional test address',
  }, 'customers');
  const technicianId = await insert('workspace_technicians', {
    workspace_id: demo.id, profile_id: demoTech.profileId, branch_id: demoBranch,
  }, 'technicians');

  const orderArgs = (workspaceId, generation, branchId, customerId, marker) => ({
    p_workspace_id: workspaceId, p_order_no: `P1-${suffix}-${marker}`,
    p_expected_generation: generation,
    p_branch_id: branchId, p_customer_id: customerId,
    p_problem_description: 'Fictional integration check', p_service_type: 'Fictional service',
    p_guest_visit_id: null, p_guest_token_hash: null,
  });
  // Track rejected-write candidates too: a boundary failure must not leave an
  // accidentally accepted row behind.
  for (const [workspaceId, marker] of [
    [demo.id, 'demo'], [demo.id, 'legacy-overload'], [demo.id, 'unassigned'], [owner.id, 'owner'],
    [owner.id, 'cross'], [demo.id, 'substitute'], [demo.id, 'tech'], [demo.id, 'direct'],
    [demo.id, 'stale-generation'],
  ]) {
    created.orders.push({ workspace_id: workspaceId, order_no: `P1-${suffix}-${marker}` });
  }
  const demoOrder = requireData(await demoAdmin.client.rpc('workspace_order_create',
    orderArgs(demo.id, demo.generation, demoBranch, demoCustomer, 'demo')), 'create Demo order');
  expect(demoOrder.workspace_id === demo.id, 'Demo Admin creates in Demo');
  expectDenied(await demoAdmin.client.rpc('workspace_order_create', {
    p_workspace_id: demo.id, p_order_no: `P1-${suffix}-legacy-overload`,
    p_expected_generation: demo.generation, p_branch_id: demoBranch,
    p_customer_id: demoCustomer, p_problem_description: 'Fictional integration check',
    p_service_type: 'Fictional service',
  }), 'retired order overload denied to authenticated actor');
  const unassigned = requireData(await demoAdmin.client.rpc('workspace_order_create',
    orderArgs(demo.id, demo.generation, demoBranch, demoCustomer, 'unassigned')), 'create unassigned Demo order');
  const ownerOrder = requireData(await ownerAdmin.client.rpc('workspace_order_create',
    orderArgs(owner.id, owner.generation, ownerBranch, ownerCustomer, 'owner')), 'create Owner order');

  expectDenied(await demoAdmin.client.rpc('workspace_order_create',
    orderArgs(owner.id, owner.generation, ownerBranch, ownerCustomer, 'cross')), 'Demo Admin cannot create Owner order');
  expectDenied(await demoAdmin.client.rpc('workspace_order_create',
    orderArgs(demo.id, demo.generation, ownerBranch, ownerCustomer, 'substitute')), 'cross-workspace FK substitution denied');
  expectDenied(await demoTech.client.rpc('workspace_order_create',
    orderArgs(demo.id, demo.generation, demoBranch, demoCustomer, 'tech')), 'Technician cannot create order');
  expectDenied(await demoAdmin.client.rpc('workspace_order_create',
    orderArgs(demo.id, demo.generation - 1, demoBranch, demoCustomer, 'stale-generation')), 'stale generation cannot create order');
  expectDenied(await demoAdmin.client.from('workspace_orders').insert({
    ...{ workspace_id: demo.id, order_no: `P1-${suffix}-direct`, branch_id: demoBranch,
      customer_id: demoCustomer, problem_description: 'Direct write', service_type: 'Fictional service',
      created_by_profile_id: demoAdmin.profileId },
  }), 'direct table write denied');

  const assignment = requireData(await demoAdmin.client.rpc('workspace_order_assign', {
    p_workspace_id: demo.id, p_expected_generation: demo.generation,
    p_order_id: demoOrder.id, p_technician_id: technicianId,
    p_expected_updated_at: demoOrder.updated_at, p_scheduled_at: null,
    p_guest_visit_id: null, p_guest_token_hash: null,
  }), 'assign Demo order');
  expect(assignment.assigned_technician_id === technicianId, 'Admin assigns Demo technician');
  expectDenied(await demoAdmin.client.rpc('workspace_order_assign', {
    p_workspace_id: owner.id, p_expected_generation: owner.generation,
    p_order_id: ownerOrder.id, p_technician_id: technicianId,
    p_expected_updated_at: ownerOrder.updated_at, p_scheduled_at: null,
    p_guest_visit_id: null, p_guest_token_hash: null,
  }), 'cross-workspace assignment denied');
  expectDenied(await demoAdmin.client.rpc('workspace_order_assign', {
    p_workspace_id: demo.id, p_expected_generation: demo.generation,
    p_order_id: demoOrder.id, p_technician_id: technicianId,
    p_expected_updated_at: demoOrder.updated_at, p_scheduled_at: null,
    p_guest_visit_id: null, p_guest_token_hash: null,
  }), 'stale assignment denied');
  expectDenied(await demoAdmin.client.rpc('workspace_order_assign', {
    p_workspace_id: demo.id, p_expected_generation: demo.generation - 1,
    p_order_id: unassigned.id, p_technician_id: technicianId,
    p_expected_updated_at: unassigned.updated_at, p_scheduled_at: null,
    p_guest_visit_id: null, p_guest_token_hash: null,
  }), 'stale generation cannot assign order');

  const demoRows = requireData(await demoAdmin.client.from('workspace_orders').select('id,workspace_id'), 'Demo RLS read');
  console.log(`CHECK Demo RLS count=${demoRows.length} own=${demoRows.some(row => row.id === demoOrder.id)} cross=${demoRows.some(row => row.id === ownerOrder.id)}`);
  for (const table of ['profiles', 'workspace_memberships', 'workspaces', 'workspace_branches', 'workspace_customers']) {
    const result = await demoAdmin.client.from(table).select('*', { count: 'exact', head: true });
    console.log(`CHECK Demo ${table} count=${result.count ?? 'null'} error=${result.error?.code ?? 'none'}`);
  }
  expect(demoRows.some(row => row.id === demoOrder.id)
    && !demoRows.some(row => row.id === ownerOrder.id), 'Demo RLS excludes Owner order');
  const ownerRows = requireData(await ownerAdmin.client.from('workspace_orders').select('id,workspace_id'), 'Owner RLS read');
  expect(ownerRows.some(row => row.id === ownerOrder.id)
    && !ownerRows.some(row => row.id === demoOrder.id), 'Owner RLS excludes Demo order');
  const techRows = requireData(await demoTech.client.from('workspace_orders').select('id,workspace_id'), 'Technician RLS read');
  expect(techRows.some(row => row.id === demoOrder.id)
    && !techRows.some(row => row.id === unassigned.id)
    && !techRows.some(row => row.id === ownerOrder.id), 'Technician sees assigned Demo order only');
  const anonymous = createClient(url, publicKey, options);
  const anonRows = await anonymous.from('workspace_orders').select('id');
  expectDenied(anonRows, 'unauthenticated Data API read denied');
  expectDenied(await demoAdmin.client.from('orders').select('id').limit(1), 'legacy table read denied');
  expectDenied(await demoAdmin.client.rpc('can_access_order', { target_order_id: randomUUID() }),
    'legacy RPC denied');
  if (httpBase) {
    const demoPage = await fetch(`${httpBase}/demo?workspace=${demo.id}`, {
      headers: { Cookie: demoAdmin.cookieHeader }, redirect: 'manual',
    });
    const demoHtml = demoPage.status === 200 ? await demoPage.text() : '';
    expect(demoPage.status === 200 && !demoHtml.includes('Current persona'),
      'HTTP Demo page keeps public entry closed');
    const read = async (workspaceId, cookieHeader) => fetch(
      `${httpBase}/api/workspaces/${workspaceId}/orders`,
      { headers: cookieHeader ? { Cookie: cookieHeader } : {}, redirect: 'manual' },
    );
    const permitted = await read(demo.id, demoAdmin.cookieHeader);
    const permittedBody = permitted.status === 200 ? await permitted.json() : null;
    expect(permitted.status === 200 && permittedBody.orders.some(row => row.id === demoOrder.id)
      && !permittedBody.orders.some(row => row.id === ownerOrder.id)
      && permittedBody.generation === demo.generation, 'HTTP verified Demo actor reads own orders');
    expect((await read(owner.id, demoAdmin.cookieHeader)).status === 403,
      'HTTP Demo actor cannot select Owner workspace');
    expect((await read(demo.id, undefined)).status === 403,
      'HTTP unauthenticated workspace read denied');
  }
  console.log(`PASS ${checks} live checks completed; removing temporary fixtures.`);
} catch (error) {
  failed = true;
  // Never print HTTP details, URLs, JWTs, or credentials from a provider error.
  console.error(`FAIL live check: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
} finally {
  await cleanup();
}
if (cleanupFailures) console.error(`CLEANUP INCOMPLETE: ${cleanupFailures} delete operation(s) failed; inspect temporary P1 records before rerunning.`);
if (failed || cleanupFailures) process.exitCode = 1;
