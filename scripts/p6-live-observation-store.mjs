// Bounded Test-only service-role check for metadata-only workspace AI observations.
// Usage: node scripts/p6-live-observation-store.mjs --allow-live
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
if (process.argv.slice(2).join(' ') !== '--allow-live') {
  console.error('Usage: node scripts/p6-live-observation-store.mjs --allow-live');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let parsed;
try { parsed = new URL(url); } catch { /* fail closed */ }
if (parsed?.protocol !== 'https:' || parsed.hostname !== `${PROJECT_REF}.supabase.co` || !serviceKey || !publicKey) {
  throw new Error('Expected complete credentials for the confirmed Test project');
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const anonymous = createClient(url, publicKey, options);
const id = randomUUID(), traceId = randomUUID();
let inserted = false;
try {
  const { data: profiles, error: profileError } = await service.from('profiles')
    .select('id').eq('demo_principal', true).eq('role', 'ADMIN').eq('platform_role', 'USER').eq('active', true);
  if (profileError || profiles?.length !== 1) throw new Error('Expected one fixed Demo Admin profile');
  const record = {
    id, traceId, createdAt: new Date().toISOString(), task: 'WORKSPACE_ORDERS',
    actorRole: 'ADMIN', status: 'CONTROLLED', durationMs: 1,
    execution: { flow: 'Bounded workspace orders agent', workspaceId: null,
      workspaceKind: 'DEMO', workspaceRole: 'ADMIN', guestVisitId: null,
      demoGeneration: null, providerSteps: 0, inputTokens: null, outputTokens: null },
    providerCalls: [], errorCode: 'GUEST_AI_EXHAUSTED',
    safety: { rawPromptPersisted: false, rawProviderResponsePersisted: false,
      sanitizedDebugPayloadPersisted: false, credentialsPersisted: false,
      documentFieldValuesPersisted: false },
  };
  const { error: insertError } = await service.from('audit_logs').insert({
    id, actor_profile_id: profiles[0].id, event_type: 'AI_OBSERVATION',
    idempotency_key: `ai-observation:${traceId}`, metadata_json: record, created_at: record.createdAt,
  });
  if (insertError) throw new Error(`Service-role insert failed: ${insertError.code ?? 'UNKNOWN'}`);
  inserted = true;
  const { data: rows, error: readError } = await service.from('audit_logs')
    .select('metadata_json').eq('id', id).eq('event_type', 'AI_OBSERVATION');
  if (readError || rows?.length !== 1 || rows[0].metadata_json?.traceId !== traceId ||
      JSON.stringify(rows[0].metadata_json).includes('private question')) throw new Error('Exact observation readback failed');
  const anonRead = await anonymous.from('audit_logs').select('id').eq('id', id);
  if (!anonRead.error && anonRead.data?.length) throw new Error('Anonymous caller read technical observation');
  console.log('PASS Test service-role observation insert/read and anonymous denial.');
} finally {
  if (inserted) {
    const { error } = await service.from('audit_logs').delete().eq('id', id).eq('event_type', 'AI_OBSERVATION');
    const { data } = await service.from('audit_logs').select('id').eq('id', id);
    if (error || data?.length !== 0) {
      console.error(`MANUAL CLEANUP REQUIRED Test audit_logs id=${id}`);
      process.exitCode = 1;
    } else console.log('PASS exact-ID observation cleanup returned zero rows.');
  }
}
