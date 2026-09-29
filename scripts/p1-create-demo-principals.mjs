// One-shot bootstrap of three server-only Demo principals. No visitor gets an
// Auth account or a principal credential. Run only against the confirmed Test project.
// node scripts/p1-create-demo-principals.mjs --allow-live
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const HOST = `${PROJECT_REF}.supabase.co`;
const PRINCIPALS = [
  ['ADMIN', 'guest-admin@sejukops.example'],
  ['MANAGER', 'guest-manager@sejukops.example'],
  ['TECHNICIAN', 'guest-technician@sejukops.example'],
];

function requireData(result, label) {
  if (result.error || !result.data) {
    throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  }
  return result.data;
}

export function derivePassword(serviceRoleKey, persona) {
  if (!serviceRoleKey || !PRINCIPALS.some(([role]) => role === persona)) {
    throw new Error('Invalid Demo principal credential configuration');
  }
  return createHmac('sha256', serviceRoleKey)
    .update(`sejukops:fixed-demo-principal:v1\0${HOST}\0${persona}`)
    .digest('base64url');
}

async function existingPrincipalEmails(service) {
  const found = new Set();
  for (let page = 1; page <= 100; page += 1) {
    const users = requireData(await service.auth.admin.listUsers({ page, perPage: 1000 }), 'list Auth users').users;
    for (const user of users) {
      if (PRINCIPALS.some(([, email]) => email === user.email?.toLowerCase())) found.add(user.email.toLowerCase());
    }
    if (users.length < 1000) return found;
  }
  throw new Error('Auth user list exceeded the review bound');
}

async function deleteExact(service, table, column, id) {
  const result = await service.from(table).delete().eq(column, id).select(column);
  if (result.error) return false;
  const remaining = await service.from(table).select(column, { count: 'exact', head: true }).eq(column, id);
  return !remaining.error && remaining.count === 0;
}

export async function provisionDemoPrincipals(service, serviceRoleKey) {
  if ((await existingPrincipalEmails(service)).size !== 0) {
    throw new Error('One or more fixed Demo principals already exist; inspect before retrying');
  }
  const demo = requireData(await service.from('workspaces')
    .select('id,kind,active').eq('kind', 'DEMO').eq('active', true).single(), 'active Demo workspace');
  if (demo.kind !== 'DEMO' || demo.active !== true) throw new Error('Expected one active Demo workspace');
  const branch = requireData(await service.from('workspace_branches')
    .select('id,workspace_id').eq('workspace_id', demo.id).eq('active', true)
    .order('code', { ascending: true }).limit(1).single(), 'active Demo branch');
  if (branch.workspace_id !== demo.id) throw new Error('Demo branch scope mismatch');

  const created = [];
  try {
    for (const [persona, email] of PRINCIPALS) {
      const auth = requireData(await service.auth.admin.createUser({
        email, password: derivePassword(serviceRoleKey, persona), email_confirm: true,
      }), `create ${persona} Auth user`);
      if (!auth.user?.id || auth.user.email?.toLowerCase() !== email) {
        throw new Error(`${persona} Auth creation returned unexpected identity; inspect before retrying`);
      }
      const row = { authUserId: auth.user.id, profileId: randomUUID(), persona, email };
      created.push(row);
      requireData(await service.from('profiles').insert({
        id: row.profileId, auth_user_id: row.authUserId,
        display_name: `Demo ${persona.toLowerCase()} principal`,
        role: persona, platform_role: 'USER', demo_principal: true, active: true,
      }).select('id').single(), `create ${persona} profile`);
      requireData(await service.from('workspace_memberships').insert({
        workspace_id: demo.id, profile_id: row.profileId, role: persona, active: true,
      }).select('profile_id').single(), `create ${persona} membership`);
      if (persona === 'TECHNICIAN') {
        requireData(await service.from('workspace_technicians').insert({
          workspace_id: demo.id, profile_id: row.profileId, branch_id: branch.id, active: true,
        }).select('id').single(), 'create Demo technician mapping');
      }
    }

    for (const row of created) {
      const user = requireData(await service.auth.admin.getUserById(row.authUserId), 'verify Auth user').user;
      const profile = requireData(await service.from('profiles')
        .select('id,auth_user_id,platform_role,demo_principal,active').eq('id', row.profileId).single(), 'verify profile');
      const member = requireData(await service.from('workspace_memberships')
        .select('workspace_id,profile_id,role,active')
        .eq('workspace_id', demo.id).eq('profile_id', row.profileId).single(), 'verify membership');
      if (user?.id !== row.authUserId || user.email?.toLowerCase() !== row.email || user.is_anonymous === true
        || profile.id !== row.profileId || profile.auth_user_id !== row.authUserId
        || profile.platform_role !== 'USER' || profile.demo_principal !== true || profile.active !== true
        || member.workspace_id !== demo.id || member.profile_id !== row.profileId
        || member.role !== row.persona || member.active !== true) {
        throw new Error('Demo principal read-back did not match expected scope');
      }
    }
    // On a fresh project the seed migration may have run before these fixed
    // principals existed. Seed now that their Demo memberships are verified.
    const seed = await service.rpc('demo_seed');
    if (seed.error || typeof seed.data !== 'boolean') {
      throw new Error('Fictional Demo seed could not be verified after principal creation');
    }
    return { workspaceId: demo.id, count: created.length };
  } catch (error) {
    let clean = true;
    for (const row of created.reverse()) {
      if (row.persona === 'TECHNICIAN') {
        clean = (await deleteExact(service, 'workspace_technicians', 'profile_id', row.profileId)) && clean;
      }
      clean = (await deleteExact(service, 'workspace_memberships', 'profile_id', row.profileId)) && clean;
      clean = (await deleteExact(service, 'profiles', 'id', row.profileId)) && clean;
      const removed = await service.auth.admin.deleteUser(row.authUserId);
      clean = !removed.error && clean;
    }
    clean = (await existingPrincipalEmails(service)).size === 0 && clean;
    if (!clean) throw new Error('ROLLBACK INCOMPLETE: inspect fixed Demo principal Auth/profile/membership rows before retrying', { cause: error });
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--allow-live') {
    throw new Error('Refusing live Demo principal creation: pass exactly --allow-live');
  }
  process.loadEnvFile('.env');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let parsed;
  try { parsed = new URL(url); } catch { /* fail closed below */ }
  if (parsed?.protocol !== 'https:' || parsed.hostname !== HOST || !key) {
    throw new Error('Refusing Demo principal creation: exact Test project credentials are required');
  }
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  await provisionDemoPrincipals(service, key);
  console.log('Three fixed Demo Auth users, profiles, and Demo-only memberships created without email delivery.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Demo principal bootstrap failed');
    process.exitCode = 1;
  });
}
