// One-shot identity bootstrap for a separately prepared, empty Supabase project.
// This does not apply migrations or reset a database. Never point it at Test.
// node scripts/p1-bootstrap-fresh.mjs --project-ref <ref> --step demo --allow-live
// node scripts/p1-bootstrap-fresh.mjs --project-ref <ref> --step owner --owner-email <email> --allow-live
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { provisionDemoPrincipals } from './p1-create-demo-principals.mjs';
import { provisionOwner } from './p1-create-owner.mjs';

const CONFIRMED_TEST_REF = 'qobhjvrrpajoyvlgrkbx';
const DEMO_IDENTITIES = [
  ['guest-admin@sejukops.example', 'ADMIN'],
  ['guest-manager@sejukops.example', 'MANAGER'],
  ['guest-technician@sejukops.example', 'TECHNICIAN'],
];

export function parseFreshTarget(argv, url, serviceRoleKey) {
  const args = argv.slice();
  if (args.at(-1) !== '--allow-live') throw new Error('Fresh bootstrap requires --allow-live');
  args.pop();
  const fields = new Map();
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!['--project-ref', '--step', '--owner-email'].includes(flag)
      || !value || value.startsWith('--') || fields.has(flag)) {
      throw new Error('Fresh bootstrap arguments are invalid');
    }
    fields.set(flag, value);
  }
  const ref = fields.get('--project-ref');
  const step = fields.get('--step');
  const ownerEmail = fields.get('--owner-email');
  if (!/^[a-z0-9]{8,32}$/.test(ref ?? '') || ref === CONFIRMED_TEST_REF
    || !['demo', 'owner'].includes(step)
    || (step === 'owner' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail ?? ''))
    || (step === 'demo' && ownerEmail !== undefined)) {
    throw new Error('Fresh bootstrap target or step is invalid');
  }
  let parsed;
  try { parsed = new URL(url); } catch { /* fail closed below */ }
  const host = `${ref}.supabase.co`;
  if (parsed?.protocol !== 'https:' || parsed.hostname !== host
    || parsed.port || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash
    || typeof serviceRoleKey !== 'string' || !serviceRoleKey.trim()) {
    throw new Error('Fresh bootstrap requires matching project URL and server-only key');
  }
  return { ref, host, url: parsed.href, step, ownerEmail: ownerEmail?.toLowerCase(), key: serviceRoleKey.trim() };
}

async function countRows(service, table, filters = []) {
  let query = service.from(table).select('*', { count: 'exact', head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  const { count, error } = await query;
  if (error || !Number.isSafeInteger(count)) throw new Error(`Could not inspect ${table} before bootstrap`);
  return count;
}

async function allAuthUsers(service) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !Array.isArray(data?.users)) throw new Error('Could not inspect Auth users before bootstrap');
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error('Auth user list exceeded bootstrap review bound');
}

/** Read-only checks run before the first Auth or table write. */
export async function verifyFreshIdentityState(service, step) {
  const { data: workspaces, error } = await service.from('workspaces')
    .select('id,kind,active');
  if (error || !Array.isArray(workspaces) || workspaces.length !== 2
    || workspaces.filter(row => row.kind === 'DEMO' && row.active).length !== 1
    || workspaces.filter(row => row.kind === 'OWNER' && row.active).length !== 1) {
    throw new Error('Fresh bootstrap requires exactly one active Demo and Owner workspace');
  }
  const demoId = workspaces.find(row => row.kind === 'DEMO').id;
  const authUsers = await allAuthUsers(service);
  const profiles = await countRows(service, 'profiles');
  const memberships = await countRows(service, 'workspace_memberships');
  if (step === 'demo') {
    const customers = await countRows(service, 'workspace_customers', [['workspace_id', demoId]]);
    const orders = await countRows(service, 'workspace_orders', [['workspace_id', demoId]]);
    if (authUsers.length || profiles || memberships || customers || orders) {
      throw new Error('Fresh Demo bootstrap requires empty Auth, profiles, memberships, and Demo data');
    }
  } else if (step === 'owner') {
    const orders = await countRows(service, 'workspace_orders', [['workspace_id', demoId]]);
    if (authUsers.length !== 3 || profiles !== 3 || memberships !== 3 || orders !== 4) {
      throw new Error('Fresh Owner bootstrap requires exactly three Demo principals and four starter orders');
    }
    const { data: profileRows, error: profileError } = await service.from('profiles')
      .select('id,auth_user_id,role,platform_role,demo_principal,active');
    const { data: membershipRows, error: membershipError } = await service.from('workspace_memberships')
      .select('workspace_id,profile_id,role,active');
    if (profileError || membershipError || !Array.isArray(profileRows) || !Array.isArray(membershipRows)
      || profileRows.length !== 3 || membershipRows.length !== 3) {
      throw new Error('Fresh Owner bootstrap could not verify Demo identity mappings');
    }
    const userByEmail = new Map(authUsers.map(user => [user.email?.toLowerCase(), user]));
    const profileByAuthId = new Map(profileRows.map(profile => [profile.auth_user_id, profile]));
    const membershipByProfileId = new Map(membershipRows.map(member => [member.profile_id, member]));
    if (userByEmail.size !== 3 || profileByAuthId.size !== 3 || membershipByProfileId.size !== 3
      || DEMO_IDENTITIES.some(([email, role]) => {
        const user = userByEmail.get(email);
        const profile = profileByAuthId.get(user?.id);
        const member = membershipByProfileId.get(profile?.id);
        return !user?.id || user.is_anonymous === true
          || !profile?.id || profile.role !== role || profile.platform_role !== 'USER'
          || profile.demo_principal !== true || profile.active !== true
          || !member || member.workspace_id !== demoId || member.role !== role || member.active !== true;
      })) {
      throw new Error('Fresh Owner bootstrap found an invalid Demo Auth/profile/membership mapping');
    }
  } else {
    throw new Error('Fresh bootstrap step is invalid');
  }
}

/** Runs after principal creation; a discrepancy requires inspection, not an unsafe broad rollback. */
export async function verifyFreshDemoSeed(service, workspaceId) {
  const { data: orders, error } = await service.from('workspace_orders')
    .select('order_no').eq('workspace_id', workspaceId);
  const customers = await countRows(service, 'workspace_customers', [['workspace_id', workspaceId]]);
  if (error || !Array.isArray(orders) || customers !== 1
    || orders.map(order => order.order_no).sort().join(',') !== 'DEMO-001,DEMO-002,DEMO-003,DEMO-004') {
    throw new Error('Fresh Demo starter rows differ from the expected one customer and four orders; inspect before retrying');
  }
}

async function main() {
  process.loadEnvFile('.env');
  const target = parseFreshTarget(process.argv.slice(2),
    process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const service = createClient(target.url, target.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  await verifyFreshIdentityState(service, target.step);
  if (target.step === 'demo') {
    const result = await provisionDemoPrincipals(service, target.key, target.host);
    await verifyFreshDemoSeed(service, result.workspaceId);
    console.log('Fresh Demo principals and four fictional orders verified.');
  } else {
    await provisionOwner(service, undefined, target.ownerEmail);
    console.log('Fresh Owner Auth, Super Admin profile, and membership verified.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Fresh bootstrap failed');
    process.exitCode = 1;
  });
}
