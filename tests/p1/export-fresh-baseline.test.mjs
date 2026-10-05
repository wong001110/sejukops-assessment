import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSchemaOnlyCandidate } from '../../scripts/p1-export-fresh-baseline.mjs';

function rawFixture(statement='CREATE TABLE public.example (id uuid);') {
  return ['\\restrict token','SET transaction_timeout = 0;','CREATE SCHEMA private;','CREATE SCHEMA public;',
    statement,'-- Name: SCHEMA private; Type: ACL;',
    '--','-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL;','--',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;',
    '--','-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL;','--',
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;',
    '-- PostgreSQL database dump complete','\\unrestrict token',''].join('\n');
}
test('schema export excludes rows, project URLs, identity UUIDs and credential patterns',()=>{
  assert.match(reviewSchemaOnlyCandidate(rawFixture()),/CREATE TABLE public.example/);
  for (const statement of [
    'INSERT INTO public.example VALUES (gen_random_uuid());',
    'COPY public.example FROM stdin;',
    "CREATE TABLE public.example (endpoint text DEFAULT 'https://fictionalproject.supabase.co');",
    "CREATE TABLE public.example (id uuid DEFAULT '11111111-1111-4111-8111-111111111111');",
    "CREATE TABLE public.example (key text DEFAULT 'sb_secret_SYNTHETIC_CANARY');",
  ]) assert.throws(()=>reviewSchemaOnlyCandidate(rawFixture(statement)),/requires review/);
  assert.throws(()=>reviewSchemaOnlyCandidate(rawFixture('-- qobhjvrrpajoyvlgrkbx')),/project-specific/);
});
test('only the existing source-defined settings singleton UUID may enter schema code',()=>{
  assert.match(reviewSchemaOnlyCandidate(rawFixture("CREATE TABLE public.ai_settings (id uuid CHECK(id='00000000-0000-4000-8000-00000000a100'));")),/ai_settings/);
  assert.throws(()=>reviewSchemaOnlyCandidate(rawFixture("CREATE TABLE public.ai_settings (id uuid CHECK(id='00000000-0000-4000-8000-00000000a101'));")),/literalUuid/);
});
