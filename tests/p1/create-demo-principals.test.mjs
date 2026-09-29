import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { derivePassword, provisionDemoPrincipals } from '../../scripts/p1-create-demo-principals.mjs';

const HOST = 'qobhjvrrpajoyvlgrkbx.supabase.co';

test('credential derivation uses the same role and host domain separator as runtime', () => {
  const admin = derivePassword('fixture-service-key', 'ADMIN');
  assert.equal(admin.length, 43);
  assert.notEqual(admin, derivePassword('fixture-service-key', 'MANAGER'));
  assert.notEqual(admin, derivePassword('other-key', 'ADMIN'));
  assert.throws(() => derivePassword('', 'ADMIN'));
  assert.equal(admin, createHmac('sha256', 'fixture-service-key')
    .update(`sejukops:fixed-demo-principal:v1\0${HOST}\0ADMIN`).digest('base64url'));
});

test('existing fixed Auth identity stops provisioning before any database write', async () => {
  let writes = 0;
  const service = {
    auth: { admin: {
      listUsers: async () => ({ data: { users: [{ email: 'guest-admin@sejukops.example' }] }, error: null }),
      createUser: async () => { writes += 1; throw new Error('must not create'); },
    } },
    from: () => { writes += 1; throw new Error('must not access tables'); },
  };
  await assert.rejects(() => provisionDemoPrincipals(service, 'fixture-service-key'), /already exist/);
  assert.equal(writes, 0);
});

test('missing active Demo branch stops provisioning before Auth creation', async () => {
  let writes = 0;
  const single = data => ({ data, error: data ? null : { code: 'PGRST116' } });
  const service = {
    auth: { admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      createUser: async () => { writes += 1; throw new Error('must not create'); },
    } },
    from(table) {
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        single: async () => single(table === 'workspaces'
          ? { id: '11111111-1111-4111-8111-111111111111', kind: 'DEMO', active: true }
          : null),
      };
      return query;
    },
  };
  await assert.rejects(() => provisionDemoPrincipals(service, 'fixture-service-key'), /active Demo branch/);
  assert.equal(writes, 0);
});
