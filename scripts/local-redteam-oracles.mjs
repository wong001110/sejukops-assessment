// Execute only these reviewed local fixture functions, never model-generated code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('scripts/fixtures/local-redteam-cases.json', 'utf8'));
for (const item of fixture.cases) {
  const run = new Function(`${item.source}; return run;`)();
  if (['Q7', 'R2'].includes(item.id)) {
    let remaining = 1;
    let dispatches = 0;
    const api = {
      status: async () => ({ remaining: 1 }),
      reserve: async () => remaining-- > 0 ? { allowed: true } : { allowed: false },
      dispatch: async () => { dispatches += 1; },
    };
    const result = await Promise.all([run(api), run(api)]);
    assert.equal(dispatches, item.id === 'Q7' ? 2 : 1);
    assert.deepEqual(result.sort(), item.id === 'Q7' ? ['DISPATCHED', 'DISPATCHED'] : ['DENIED', 'DISPATCHED']);
    if (item.id === 'R2') {
      for (const reservation of [null, { allowed: false }]) {
        let calls = 0;
        const denied = await run({ status: api.status, reserve: async () => reservation,
          dispatch: async () => { calls += 1; } });
        assert.equal(denied, 'DENIED');
        assert.equal(calls, 0);
      }
    }
    console.log(JSON.stringify({ id: item.id, oracle: item.oracle, result, dispatches, pass: true }));
  } else {
    let mutations = 0;
    const actor = { authUserId: 'auth-fixture', profileId: 'profile-fixture' };
    const api = { approve: async (args) => {
      if (args.p_approver_auth_user_id !== actor.authUserId) return 'DENIED';
      mutations += 1;
      return 'APPROVED';
    } };
    const result = await run(actor, api);
    assert.equal(result, item.id === 'T5' ? 'DENIED' : 'APPROVED');
    assert.equal(mutations, item.id === 'T5' ? 0 : 1);
    console.log(JSON.stringify({ id: item.id, oracle: item.oracle, result, mutations, pass: true }));
  }
}
