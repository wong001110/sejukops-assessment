import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { parseFreshTarget, verifyFreshDemoSeed, verifyFreshIdentityState } from '../../scripts/p1-bootstrap-fresh.mjs';
import { derivePassword } from '../../scripts/p1-create-demo-principals.mjs';

const REF = 'abcdefghijklmnopqrst';
const URL = `https://${REF}.supabase.co`;
const ENV_FILE = 'supabase/.temp/fresh.env';
const DEMO_ARGS = ['--project-ref', REF, '--credentials-file', ENV_FILE, '--step', 'demo', '--allow-live'];

test('fresh target requires exact URL/ref and refuses prepared Test before any service call', () => {
  assert.deepEqual(parseFreshTarget(DEMO_ARGS, URL, 'secret'), {
    ref: REF, host: `${REF}.supabase.co`, url: `${URL}/`, envFile: ENV_FILE, step: 'demo',
    ownerEmail: undefined, key: 'secret',
  });
  for (const [args, url] of [
    [DEMO_ARGS, 'https://qobhjvrrpajoyvlgrkbx.supabase.co'],
    [['--project-ref', 'qobhjvrrpajoyvlgrkbx', '--credentials-file', ENV_FILE, '--step', 'demo', '--allow-live'],
      'https://qobhjvrrpajoyvlgrkbx.supabase.co'],
    [DEMO_ARGS, `${URL}/rest/v1`],
    [DEMO_ARGS, `http://${REF}.supabase.co`],
    [DEMO_ARGS.slice(0, -1), URL],
    [['--project-ref', REF, '--credentials-file', ENV_FILE, '--step', 'owner', '--allow-live'], URL],
    [['--project-ref', REF, '--step', 'demo', '--allow-live'], URL],
  ]) assert.throws(() => parseFreshTarget(args, url, 'secret'));
  assert.throws(() => parseFreshTarget(DEMO_ARGS, URL, ''));
});

test('fresh Owner target needs explicit email and matching URL', () => {
  const result = parseFreshTarget([
    '--project-ref', REF, '--credentials-file', ENV_FILE, '--step', 'owner',
    '--owner-email', 'OWNER@EXAMPLE.COM', '--allow-live',
  ], URL, 'secret');
  assert.equal(result.ownerEmail, 'owner@example.com');
});

test('portable Demo password uses the runtime host-and-persona domain separator', () => {
  const actual = derivePassword('fixture-key', 'TECHNICIAN', `${REF}.supabase.co`);
  const expected = createHmac('sha256', 'fixture-key')
    .update(`sejukops:fixed-demo-principal:v1\0${REF}.supabase.co\0TECHNICIAN`)
    .digest('base64url');
  assert.equal(actual, expected);
  assert.notEqual(actual, derivePassword('fixture-key', 'TECHNICIAN'));
  assert.throws(() => derivePassword('fixture-key', 'ADMIN', 'evil.example.com'));
});

const expectedPersona = {
  'guest-admin@sejukops.example': 'ADMIN',
  'guest-manager@sejukops.example': 'MANAGER',
  'guest-technician@sejukops.example': 'TECHNICIAN',
};

function freshService({ emails = [], profiles = 0, memberships = 0, customers = 0, orders = 0,
  profileRows, membershipRows, authUsers } = {}) {
  let writes = 0;
  const workspaces = [
    { id: 'demo-id', kind: 'DEMO', active: true },
    { id: 'owner-id', kind: 'OWNER', active: true },
  ];
  const users = authUsers ?? emails.map((email, index) => ({ id: `auth-${index}`, email, is_anonymous: false }));
  const seededProfiles = profileRows ?? users.map((user, index) => ({
    id: `profile-${index}`, auth_user_id: user.id, role: expectedPersona[user.email],
    platform_role: 'USER', demo_principal: true, active: true,
  }));
  const seededMemberships = membershipRows ?? seededProfiles.map(profile => ({
    workspace_id: 'demo-id', profile_id: profile.id, role: profile.role, active: true,
  }));
  const service = {
    auth: { admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      createUser: async () => { writes += 1; throw new Error('write forbidden'); },
    } },
    from(table) {
      const query = {
        filters: [],
        select(_columns, options) { this.options = options; return this; },
        eq(column, value) { this.filters.push([column, value]); return this; },
        then(resolve) {
          const count = { profiles, workspace_memberships: memberships,
              workspace_customers: customers, workspace_orders: orders }[table];
          return Promise.resolve(this.options?.head
            ? { count, error: null }
            : { data: table === 'profiles' ? seededProfiles
              : table === 'workspace_memberships' ? seededMemberships : workspaces, error: null }).then(resolve);
        },
        insert() { writes += 1; throw new Error('write forbidden'); },
      };
      return query;
    },
  };
  return { service, get writes() { return writes; } };
}

test('fresh Demo preflight permits empty identities and rejects existing data without writes', async () => {
  const clean = freshService();
  await verifyFreshIdentityState(clean.service, 'demo');
  for (const state of [{ emails: ['unexpected@example.com'] }, { profiles: 1 },
    { memberships: 1 }, { orders: 1 }]) {
    const fixture = freshService(state);
    await assert.rejects(verifyFreshIdentityState(fixture.service, 'demo'));
    assert.equal(fixture.writes, 0);
  }
});

test('fresh Owner preflight accepts only exactly three Demo principals and four orders', async () => {
  const state = { emails: ['guest-admin@sejukops.example', 'guest-manager@sejukops.example',
    'guest-technician@sejukops.example'], profiles: 3,
    memberships: 3, orders: 4 };
  await verifyFreshIdentityState(freshService(state).service, 'owner');
  const fixture = freshService({ ...state, emails: [...state.emails, 'unexpected@example.com'] });
  await assert.rejects(verifyFreshIdentityState(fixture.service, 'owner'));
  assert.equal(fixture.writes, 0);
  const normal = freshService(state);
  const base = state.emails.map((email, index) => ({
    id: `profile-${index}`, auth_user_id: `auth-${index}`, role: expectedPersona[email],
    platform_role: 'USER', demo_principal: true, active: true,
  }));
  for (const wrongProfiles of [
    base.map((row, index) => index === 0 ? { ...row, role: 'MANAGER' } : row),
    base.map((row, index) => index === 0 ? { ...row, auth_user_id: 'auth-1' } : row),
    base.map((row, index) => index === 0 ? { ...row, platform_role: 'SUPER_ADMIN' } : row),
    base.map((row, index) => index === 0 ? { ...row, active: false } : row),
  ]) {
    const bad = freshService({ ...state, profileRows: wrongProfiles });
    await assert.rejects(verifyFreshIdentityState(bad.service, 'owner'), /mapping/);
    assert.equal(bad.writes, 0);
  }
  const wrongScope = base.map(row => ({
    workspace_id: 'owner-id', profile_id: row.id, role: row.role, active: true,
  }));
  const badScope = freshService({ ...state, membershipRows: wrongScope });
  await assert.rejects(verifyFreshIdentityState(badScope.service, 'owner'), /mapping/);
  assert.equal(badScope.writes, 0);
  const wrongRole = wrongScope.map(row => ({ ...row, workspace_id: 'demo-id', role: 'ADMIN' }));
  const badRole = freshService({ ...state, membershipRows: wrongRole });
  await assert.rejects(verifyFreshIdentityState(badRole.service, 'owner'), /mapping/);
  assert.equal(badRole.writes, 0);
  const inactiveMember = freshService({ ...state, membershipRows: wrongRole.map((row, index) =>
    index === 0 ? { ...row, role: 'ADMIN', active: false } : { ...row, role: expectedPersona[state.emails[index]] }) });
  await assert.rejects(verifyFreshIdentityState(inactiveMember.service, 'owner'), /mapping/);
  assert.equal(inactiveMember.writes, 0);
  const anonymous = freshService({ ...state, authUsers: state.emails.map((email, index) => ({
    id: `auth-${index}`, email, is_anonymous: index === 0,
  })) });
  await assert.rejects(verifyFreshIdentityState(anonymous.service, 'owner'), /mapping/);
  assert.equal(anonymous.writes, 0);
  assert.equal(normal.writes, 0);
});

test('fresh Demo readback requires the one-customer, four-order fictional baseline', async () => {
  const service = {
    from(table) {
      const query = {
        select(_columns, options) { this.options = options; return this; },
        eq() { return this; },
        then(resolve) {
          return Promise.resolve(this.options?.head
            ? { count: table === 'workspace_customers' ? 1 : 0, error: null }
            : { data: ['DEMO-004', 'DEMO-001', 'DEMO-003', 'DEMO-002']
              .map(order_no => ({ order_no })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  await verifyFreshDemoSeed(service, 'demo-id');
  const badService = {
    from() {
      const query = { select() { return this; }, eq() { return this; },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
      return query;
    },
  };
  await assert.rejects(verifyFreshDemoSeed(badService, 'demo-id'));
});
