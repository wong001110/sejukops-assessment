import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionOwner } from '../../scripts/p1-create-owner.mjs';

function fakeService({ existingOwner = false, superAdmin = false, membership = false, failMembershipInsert = false, failAuthDelete = false } = {}) {
  const rows = {
    profiles: superAdmin ? [{ id: 'existing-admin', platform_role: 'SUPER_ADMIN', active: true }] : [],
    workspaces: [{ id: 'owner-workspace', kind: 'OWNER', active: true }],
    workspace_memberships: membership ? [{ profile_id: 'existing-member', workspace_id: 'owner-workspace', active: true }] : [],
  };
  const users = existingOwner ? [{ id: 'existing-auth', email: 'sejukops@superadmin.com' }] : [];
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select(column, options = {}) { this.column = column; this.options = options; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    insert(row) { this.operation = 'insert'; this.row = row; return this; }
    delete() { this.operation = 'delete'; return this; }
    single() { return this.run(true); }
    then(resolve, reject) { return Promise.resolve(this.run(false)).then(resolve, reject); }
    run(single) {
      if (this.operation === 'insert') {
        if (this.table === 'workspace_memberships' && failMembershipInsert) return { data: null, error: { code: 'TEST_FAILURE' } };
        rows[this.table].push(this.row);
        return { data: this.row, error: null };
      }
      const found = rows[this.table].filter(row => this.filters.every(([key, value]) => row[key] === value));
      if (this.operation === 'delete') {
        rows[this.table] = rows[this.table].filter(row => !found.includes(row));
        return { data: found, error: null };
      }
      if (this.options?.head) return { count: found.length, error: null };
      return single ? { data: found.length === 1 ? found[0] : null, error: found.length === 1 ? null : { code: 'ROW_COUNT' } }
        : { data: found, error: null };
    }
  }
  const service = {
    from: table => new Query(table),
    auth: { admin: {
      listUsers: async () => ({ data: { users: users.slice() }, error: null }),
      getUserById: async id => ({
        data: { user: users.find(user => user.id === id) ?? null }, error: null,
      }),
      createUser: async attributes => {
        calls.push(attributes);
        const user = { id: 'created-auth', email: attributes.email };
        users.push(user);
        return { data: { user }, error: null };
      },
      deleteUser: async id => {
        if (failAuthDelete) return { error: { code: 'TEST_FAILURE' } };
        const index = users.findIndex(user => user.id === id);
        if (index >= 0) users.splice(index, 1);
        return { error: null };
      },
    } },
  };
  return { service, rows, users, calls };
}

test('creates exactly one confirmed Owner with a Super Admin profile and Owner membership', async () => {
  const fixture = fakeService();
  const result = await provisionOwner(fixture.service, async () => 'a-long-test-password');
  assert.equal(result.authUserId, 'created-auth');
  assert.deepEqual(fixture.calls, [{ email: 'sejukops@superadmin.com', password: 'a-long-test-password', email_confirm: true }]);
  assert.equal(fixture.rows.profiles[0].platform_role, 'SUPER_ADMIN');
  assert.equal(fixture.rows.workspace_memberships[0].workspace_id, 'owner-workspace');
});

test('portable Owner creation uses the explicitly selected email', async () => {
  const fixture = fakeService();
  await provisionOwner(fixture.service, async () => 'a-long-test-password', 'owner@example.com');
  assert.equal(fixture.calls[0].email, 'owner@example.com');
});

test('fails closed before password entry or writes if identity or Owner membership exists', async () => {
  for (const state of [{ existingOwner: true }, { superAdmin: true }, { membership: true }]) {
    const fixture = fakeService(state);
    let prompted = false;
    await assert.rejects(provisionOwner(fixture.service, async () => { prompted = true; return 'a-long-test-password'; }));
    assert.equal(prompted, false);
    assert.equal(fixture.calls.length, 0);
  }
});

test('rolls back only the newly created Auth and profile on membership failure', async () => {
  const fixture = fakeService({ failMembershipInsert: true });
  await assert.rejects(provisionOwner(fixture.service, async () => 'a-long-test-password'), /create Owner membership/);
  assert.deepEqual(fixture.users, []);
  assert.deepEqual(fixture.rows.profiles, []);
  assert.deepEqual(fixture.rows.workspace_memberships, []);
});

test('reports incomplete rollback and leaves the remaining Auth user visible for inspection', async () => {
  const fixture = fakeService({ failMembershipInsert: true, failAuthDelete: true });
  await assert.rejects(provisionOwner(fixture.service, async () => 'a-long-test-password'), /ROLLBACK INCOMPLETE/);
  assert.deepEqual(fixture.users.map(user => user.id), ['created-auth']);
  assert.deepEqual(fixture.rows.profiles, []);
});
