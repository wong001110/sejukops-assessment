// One-shot, no-email Owner bootstrap for the explicitly confirmed Supabase Test project.
// Run in a real local terminal: node scripts/p1-create-owner.mjs --allow-live
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const OWNER_EMAIL = 'sejukops@superadmin.com';

function requireData(result, label) {
  if (result.error || !result.data) {
    throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  }
  return result.data;
}

async function ownerAuthExists(service) {
  for (let page = 1; page <= 100; page += 1) {
    const users = requireData(await service.auth.admin.listUsers({ page, perPage: 1000 }), 'list Auth users').users;
    if (users.some(user => user.email?.toLowerCase() === OWNER_EMAIL)) return true;
    if (users.length < 1000) return false;
  }
  throw new Error('Auth user list exceeded the review bound');
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stderr.isTTY || !process.stdin.setRawMode) {
    throw new Error('A local interactive terminal is required for password entry');
  }
  process.stderr.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onKey = (character, key) => {
      if (key?.ctrl && key.name === 'c') return finish(new Error('Password entry cancelled'));
      if (key?.name === 'return' || key?.name === 'enter') return finish();
      if (key?.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (!key?.ctrl && !key?.meta && character && !/\p{Cc}/u.test(character)) {
        value += character;
      }
    };
    process.stdin.on('keypress', onKey);
  });
}

async function readOwnerPassword() {
  const first = await readHidden('New Owner password (hidden): ');
  const second = await readHidden('Repeat Owner password (hidden): ');
  if (first.length < 12 || first !== second) throw new Error('Password must be at least 12 characters and match');
  return first;
}

async function deleteExact(service, table, column, id) {
  const result = await service.from(table).delete().eq(column, id).select(column);
  if (result.error) return false;
  const remaining = await service.from(table).select(column, { count: 'exact', head: true }).eq(column, id);
  return !remaining.error && remaining.count === 0;
}

export async function provisionOwner(service, getPassword = readOwnerPassword) {
  if (await ownerAuthExists(service)) throw new Error('Owner Auth account already exists; inspect it instead of creating another');
  const { count: superAdmins, error: countError } = await service.from('profiles')
    .select('id', { count: 'exact', head: true }).eq('platform_role', 'SUPER_ADMIN').eq('active', true);
  if (countError || superAdmins !== 0) throw new Error('Expected exactly zero active platform Super Admin profiles');
  const owner = requireData(await service.from('workspaces').select('id')
    .eq('kind', 'OWNER').eq('active', true).single(), 'Owner workspace');
  const { count: memberships, error: membershipError } = await service.from('workspace_memberships')
    .select('profile_id', { count: 'exact', head: true }).eq('workspace_id', owner.id).eq('active', true);
  if (membershipError || memberships !== 0) throw new Error('Expected exactly zero active Owner workspace memberships');

  const password = await getPassword();
  if (typeof password !== 'string' || password.length < 12) throw new Error('Owner password must be at least 12 characters');

  let authUserId;
  let profileId;
  try {
    const auth = requireData(await service.auth.admin.createUser({
      email: OWNER_EMAIL, password, email_confirm: true,
    }), 'create Owner Auth user');
    if (!auth.user?.id) throw new Error('Auth creation returned no user ID; inspect before retrying');
    authUserId = auth.user.id;
    profileId = randomUUID();
    requireData(await service.from('profiles').insert({
      id: profileId, auth_user_id: authUserId, display_name: 'Sejuk Ops Owner',
      role: 'ADMIN', platform_role: 'SUPER_ADMIN', active: true,
    }).select('id').single(), 'create Owner profile');
    requireData(await service.from('workspace_memberships').insert({
      workspace_id: owner.id, profile_id: profileId, role: 'ADMIN', active: true,
    }).select('profile_id').single(), 'create Owner membership');
    const verifiedAuth = requireData(await service.auth.admin.getUserById(authUserId), 'verify Owner Auth user').user;
    const verifiedProfile = requireData(await service.from('profiles')
      .select('id,auth_user_id,platform_role,active').eq('id', profileId).single(), 'verify Owner profile');
    const verifiedMembership = requireData(await service.from('workspace_memberships')
      .select('profile_id,workspace_id,role,active')
      .eq('workspace_id', owner.id).eq('profile_id', profileId).single(), 'verify Owner membership');
    if (verifiedAuth?.id !== authUserId || verifiedAuth.email?.toLowerCase() !== OWNER_EMAIL
      || verifiedProfile.id !== profileId || verifiedProfile.auth_user_id !== authUserId
      || verifiedProfile.platform_role !== 'SUPER_ADMIN' || verifiedProfile.active !== true
      || verifiedMembership.profile_id !== profileId || verifiedMembership.workspace_id !== owner.id
      || verifiedMembership.role !== 'ADMIN' || verifiedMembership.active !== true) {
      throw new Error('Owner post-creation verification failed');
    }
    return { authUserId, profileId, workspaceId: owner.id };
  } catch (error) {
    if (!authUserId) throw error;
    const membershipClean = profileId ? await deleteExact(service, 'workspace_memberships', 'profile_id', profileId) : true;
    const profileClean = profileId ? await deleteExact(service, 'profiles', 'id', profileId) : true;
    const deleted = await service.auth.admin.deleteUser(authUserId);
    const authClean = !deleted.error && !(await ownerAuthExists(service));
    if (!membershipClean || !profileClean || !authClean) {
      throw new Error('ROLLBACK INCOMPLETE: inspect the exact Owner Auth/profile/membership IDs before retrying', { cause: error });
    }
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--allow-live') {
    throw new Error('Refusing live Owner creation: pass exactly --allow-live');
  }
  process.loadEnvFile('.env');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let parsed;
  try { parsed = new URL(url); } catch { /* fail closed below */ }
  if (parsed?.protocol !== 'https:' || parsed.hostname !== `${PROJECT_REF}.supabase.co` || !serviceKey) {
    throw new Error('Refusing Owner creation: exact Test project credentials are required');
  }
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  await provisionOwner(service);
  console.log('Owner Auth, Super Admin profile, and Owner membership created without email.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    // Never print provider error bodies, which might contain submitted fields.
    console.error(error instanceof Error ? error.message : 'Owner bootstrap failed');
    process.exitCode = 1;
  });
}
