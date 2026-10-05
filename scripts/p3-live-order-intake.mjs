// Bounded real-JWT check for the confirmed Sejuk Ops Test project only.
// Usage: node scripts/p3-live-order-intake.mjs --allow-live
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
if (process.argv.length !== 3 || process.argv[2] !== '--allow-live') {
  console.error('Refusing live writes: pass exactly --allow-live.');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let parsedUrl;
try { parsedUrl = new URL(url); } catch { /* fail closed */ }
if (parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${PROJECT_REF}.supabase.co`
    || !publicKey || !serviceKey) {
  console.error(`Refusing live writes: require complete credentials for ${PROJECT_REF}.supabase.co.`);
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const suffix = randomBytes(10).toString('hex');
const password = randomBytes(36).toString('base64url');
const marker = `P3-INTAKE-${suffix}`;
const created = { users: [], profiles: [], memberships: [], branches: [], orders: [], customers: [] };
let checks = 0;
let cleanupFailures = 0;

function data(result, label) {
  if (result.error || !result.data) throw new Error(`${label}: ${result.error?.code ?? 'NO_DATA'}`);
  return result.data;
}
function expect(condition, label) {
  if (!condition) throw new Error(`${label}: unexpected result`);
  checks += 1;
  console.log(`PASS ${label}`);
}
function denied(result, label) { expect(Boolean(result.error), label); }

async function user(label, role, workspaceId) {
  const email = `p3-intake-${label}-${suffix}@example.invalid`;
  const authUser = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `auth ${label}`).user;
  created.users.push(authUser.id);
  const profileId = randomUUID();
  created.profiles.push(profileId);
  data(await admin.from('profiles').insert({ id: profileId, auth_user_id: authUser.id,
    display_name: `${marker} ${label}`, role, platform_role: 'USER', active: true }).select('id').single(), `profile ${label}`);
  created.memberships.push({ workspaceId, profileId });
  data(await admin.from('workspace_memberships').insert({ workspace_id: workspaceId,
    profile_id: profileId, role, active: true }).select('profile_id').single(), `membership ${label}`);
  const client = createClient(url, publicKey, options);
  const session = data(await client.auth.signInWithPassword({ email, password }), `login ${label}`);
  expect(session.user.id === authUser.id && Boolean(session.session?.access_token), `${label} has real JWT`);
  return client;
}

async function customerRows(workspaceId, name) {
  return data(await admin.from('workspace_customers').select('id').eq('workspace_id', workspaceId)
    .eq('name', name), `customer read ${name}`);
}
async function cleanup() {
  // Include any mistakenly committed rows from denied calls. Names/order numbers
  // are unique to this run; never use a broad project or workspace deletion.
  for (const orderNo of ['success', 'cross', 'tech', 'stale', 'invalid', 'duplicate']) {
    const { data: rows, error } = await admin.from('workspace_orders').select('id')
      .eq('order_no', `${marker}-${orderNo}`);
    if (error) { cleanupFailures++; continue; }
    created.orders.push(...rows.map(row => row.id));
  }
  for (const id of new Set(created.orders)) {
    const { error } = await admin.from('workspace_orders').delete().eq('id', id);
    if (error) cleanupFailures++;
  }
  for (const name of ['success', 'cross', 'tech', 'stale', 'invalid', 'duplicate']) {
    const { data: rows, error } = await admin.from('workspace_customers').select('id')
      .eq('name', `${marker}-${name}`);
    if (error) { cleanupFailures++; continue; }
    created.customers.push(...rows.map(row => row.id));
  }
  for (const id of new Set(created.customers)) {
    const { error } = await admin.from('workspace_customers').delete().eq('id', id);
    if (error) cleanupFailures++;
  }
  for (const id of created.branches) {
    const { error } = await admin.from('workspace_branches').delete().eq('id', id);
    if (error) cleanupFailures++;
  }
  for (const { workspaceId, profileId } of created.memberships.reverse()) {
    const { error } = await admin.from('workspace_memberships').delete()
      .eq('workspace_id', workspaceId).eq('profile_id', profileId);
    if (error) cleanupFailures++;
  }
  for (const id of created.profiles) {
    const { error } = await admin.from('profiles').delete().eq('id', id);
    if (error) cleanupFailures++;
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) cleanupFailures++;
  }
  const [orders, customers, branches, profiles] = await Promise.all([
    admin.from('workspace_orders').select('id').like('order_no', `${marker}-%`),
    admin.from('workspace_customers').select('id').like('name', `${marker}-%`),
    admin.from('workspace_branches').select('id').eq('code', marker),
    admin.from('profiles').select('id').like('display_name', `${marker}%`),
  ]);
  const memberships = await Promise.all(created.memberships.map(({ workspaceId, profileId }) =>
    admin.from('workspace_memberships').select('profile_id').eq('workspace_id', workspaceId)
      .eq('profile_id', profileId)));
  const authUsers = await Promise.all(created.users.map(id => admin.auth.admin.getUserById(id)));
  expect(!orders.error && !customers.error && !branches.error && !profiles.error &&
    orders.data.length === 0 && customers.data.length === 0 &&
    branches.data.length === 0 && profiles.data.length === 0 &&
    memberships.every(result => !result.error && result.data.length === 0) &&
    authUsers.every(result => result.error || !result.data?.user),
  'exact fixture rows cleaned');
}

let failed = false;
try {
  const demo = data(await admin.from('workspaces').select('id,generation').eq('kind', 'DEMO').single(), 'Demo');
  const owner = data(await admin.from('workspaces').select('id,generation').eq('kind', 'OWNER').single(), 'Owner');
  const demoAdmin = await user('admin', 'ADMIN', demo.id);
  const demoTech = await user('tech', 'TECHNICIAN', demo.id);
  const branchId = randomUUID();
  created.branches.push(branchId);
  data(await admin.from('workspace_branches').insert({ id: branchId, workspace_id: demo.id,
    code: marker, name: `${marker} fictional branch` }).select('id').single(), 'branch');
  const args = (name, overrides = {}) => ({
    p_workspace_id: demo.id, p_expected_generation: demo.generation,
    p_order_no: `${marker}-${name}`, p_branch_id: branchId,
    p_customer_name: `${marker}-${name}`, p_customer_phone: null,
    p_customer_address: 'Fictional integration address',
    p_problem_description: 'Fictional repair', p_service_type: 'Fictional service',
    ...overrides,
  });
  const success = data(await demoAdmin.rpc('workspace_order_create_with_customer', args('success')), 'create order/customer');
  created.orders.push(success.id);
  created.customers.push(success.customer_id);
  expect(success.workspace_id === demo.id && success.branch_id === branchId &&
    (await customerRows(demo.id, `${marker}-success`)).some(row => row.id === success.customer_id),
  'Demo Admin creates linked customer and order');
  denied(await demoAdmin.rpc('workspace_order_create_with_customer', args('cross', {
    p_workspace_id: owner.id, p_expected_generation: owner.generation,
  })), 'Demo Admin cannot create Owner customer/order');
  denied(await demoTech.rpc('workspace_order_create_with_customer', args('tech')),
    'Technician cannot create customer/order');
  denied(await demoAdmin.rpc('workspace_order_create_with_customer', args('stale', {
    p_expected_generation: demo.generation - 1,
  })), 'stale generation rejected');
  denied(await demoAdmin.rpc('workspace_order_create_with_customer', args('invalid', {
    p_customer_phone: 'bad-phone',
  })), 'invalid customer input rejected');
  denied(await demoAdmin.rpc('workspace_order_create_with_customer', args('duplicate', {
    p_order_no: `${marker}-success`,
  })), 'duplicate order number rejected');
  for (const name of ['cross', 'tech', 'stale', 'invalid', 'duplicate']) {
    expect((await customerRows(demo.id, `${marker}-${name}`)).length === 0,
      `${name} customer insert rolled back`);
  }
  const { data: ownerCustomer, error: ownerError } = await admin.from('workspace_customers')
    .select('id').eq('workspace_id', owner.id).eq('name', `${marker}-cross`);
  expect(!ownerError && ownerCustomer.length === 0, 'Owner workspace received no fixture customer');
  console.log(`PASS ${checks} live checks completed; cleaning fixture.`);
} catch (error) {
  failed = true;
  console.error(`FAIL live check: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
} finally {
  try { await cleanup(); } catch (error) {
    cleanupFailures++;
    console.error(`CLEANUP FAILED: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  }
}
if (cleanupFailures) console.error(`CLEANUP INCOMPLETE: ${cleanupFailures} operation(s).`);
if (failed || cleanupFailures) process.exitCode = 1;
