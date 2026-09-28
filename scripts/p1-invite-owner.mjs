// One-shot Owner invitation for the explicitly confirmed Supabase Test project.
// Requires OWNER_INVITE_REDIRECT_URL and --allow-live. Never prints credentials.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const OWNER_EMAIL = 'sejukops@superadmin.com';
if (process.argv.length !== 3 || process.argv[2] !== '--allow-live') {
  console.error('Refusing live invitation: pass exactly --allow-live.');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const redirectValue = process.env.OWNER_INVITE_REDIRECT_URL;
let parsedUrl;
let redirect;
try { parsedUrl = new URL(url); redirect = new URL(redirectValue); } catch { /* fail closed below */ }
if (
  parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${PROJECT_REF}.supabase.co` ||
  !serviceKey || !redirect || redirect.pathname !== '/auth/confirm' ||
  redirect.search || redirect.hash ||
  (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === 'localhost'))
) {
  console.error('Refusing invitation: project credentials or exact callback URL are invalid.');
  process.exit(2);
}

const service = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

function requireData(result, label) {
  if (result.error || !result.data) {
    throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  }
  return result.data;
}

async function existingOwnerAuthUser() {
  for (let page = 1; page <= 100; page += 1) {
    const result = requireData(await service.auth.admin.listUsers({ page, perPage: 1000 }), 'list Auth users');
    if (result.users.some(user => user.email?.toLowerCase() === OWNER_EMAIL)) return true;
    if (result.users.length < 1000) return false;
  }
  throw new Error('Auth user list exceeded the review bound');
}

let invitedUserId;
let profileId;
let succeeded = false;
try {
  if (await existingOwnerAuthUser()) throw new Error('Owner Auth account already exists; inspect it instead of creating another');
  const { count: superAdmins, error: countError } = await service.from('profiles')
    .select('id', { count: 'exact', head: true }).eq('platform_role', 'SUPER_ADMIN').eq('active', true);
  if (countError || superAdmins !== 0) throw new Error('Expected exactly zero active platform Super Admin profiles');
  const owner = requireData(await service.from('workspaces').select('id')
    .eq('kind', 'OWNER').eq('active', true).single(), 'Owner workspace');

  const invite = requireData(await service.auth.admin.inviteUserByEmail(OWNER_EMAIL, {
    redirectTo: redirect.toString(),
  }), 'send Owner invitation');
  if (!invite.user?.id) throw new Error('Invitation returned no Auth user ID');
  invitedUserId = invite.user.id;
  profileId = randomUUID();
  requireData(await service.from('profiles').insert({
    id: profileId, auth_user_id: invitedUserId, display_name: 'Sejuk Ops Owner',
    role: 'ADMIN', platform_role: 'SUPER_ADMIN', active: true,
  }).select('id').single(), 'create Owner profile');
  requireData(await service.from('workspace_memberships').insert({
    workspace_id: owner.id, profile_id: profileId, role: 'ADMIN', active: true,
  }).select('profile_id').single(), 'create Owner membership');
  succeeded = true;
  console.log('Owner invitation sent and the single platform/workspace Owner actor was provisioned.');
} catch (error) {
  console.error(`Owner invitation failed: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
} finally {
  if (!succeeded) {
    let cleanupFailed = false;
    if (profileId) {
      const { error } = await service.from('workspace_memberships').delete().eq('profile_id', profileId);
      cleanupFailed ||= Boolean(error);
    }
    if (profileId) {
      const { error } = await service.from('profiles').delete().eq('id', profileId);
      cleanupFailed ||= Boolean(error);
    }
    if (invitedUserId) {
      const { error } = await service.auth.admin.deleteUser(invitedUserId);
      cleanupFailed ||= Boolean(error);
    }
    if (cleanupFailed) console.error('ROLLBACK INCOMPLETE: inspect the intended Owner account before retrying.');
    process.exitCode = 1;
  }
}
