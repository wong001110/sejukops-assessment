\set ON_ERROR_STOP on

\echo 'Creating isolated synthetic schema and roles'
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
END $$;

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  active boolean NOT NULL,
  generation integer NOT NULL
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  active boolean NOT NULL
);
CREATE TABLE public.workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  role text NOT NULL,
  active boolean NOT NULL,
  PRIMARY KEY (workspace_id, profile_id)
);

INSERT INTO public.workspaces VALUES
  ('10000000-0000-4000-8000-000000000001', 'DEMO', true, 7),
  ('10000000-0000-4000-8000-000000000002', 'OWNER', true, 3),
  ('10000000-0000-4000-8000-000000000003', 'DEMO', false, 7);
INSERT INTO public.profiles VALUES
  ('20000000-0000-4000-8000-000000000001', true),
  ('20000000-0000-4000-8000-000000000002', true),
  ('20000000-0000-4000-8000-000000000003', true),
  ('20000000-0000-4000-8000-000000000004', false),
  ('20000000-0000-4000-8000-000000000005', true);
INSERT INTO public.workspace_memberships VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'MANAGER', true),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'ADMIN', true),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'TECHNICIAN', true),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'MANAGER', true),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', 'MANAGER', false);
GRANT SELECT ON public.workspaces, public.profiles, public.workspace_memberships TO service_role;
GRANT UPDATE (generation) ON public.workspaces TO service_role;

\echo 'Applying the additive product migration to this disposable PostgreSQL cluster'
\ir ../../supabase/migrations/20261009121229_ai_session_history.sql

DO $$
DECLARE
  v_begin oid := 'public.ai_session_turn_begin(uuid,uuid,uuid,uuid,text,text,text,integer,text)'::regprocedure;
  v_finish oid := 'public.ai_session_turn_finish(uuid,uuid,text,integer,text,text,jsonb,jsonb)'::regprocedure;
BEGIN
  IF current_setting('server_version_num')::integer / 10000 <> 17 THEN RAISE EXCEPTION 'Expected PostgreSQL 17'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ai_chat_sessions'::regclass) OR
     NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.ai_chat_turns'::regclass) THEN RAISE EXCEPTION 'RLS is not enabled'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('ai_chat_sessions','ai_chat_turns')) <> 0 THEN
    RAISE EXCEPTION 'Unexpected direct-client RLS policy';
  END IF;
  IF has_table_privilege('anon','public.ai_chat_sessions','SELECT') OR has_table_privilege('authenticated','public.ai_chat_sessions','SELECT') OR
     has_table_privilege('anon','public.ai_chat_turns','INSERT') OR has_table_privilege('authenticated','public.ai_chat_turns','INSERT') THEN
    RAISE EXCEPTION 'Browser role has direct table access';
  END IF;
  IF NOT has_table_privilege('service_role','public.ai_chat_sessions','SELECT,INSERT,UPDATE') OR
     NOT has_table_privilege('service_role','public.ai_chat_turns','SELECT,INSERT,UPDATE') OR
     has_table_privilege('service_role','public.ai_chat_sessions','DELETE') THEN RAISE EXCEPTION 'Service role table grants differ from the intended contract'; END IF;
  IF has_function_privilege('anon',v_begin,'EXECUTE') OR has_function_privilege('authenticated',v_begin,'EXECUTE') OR
     has_function_privilege('anon',v_finish,'EXECUTE') OR has_function_privilege('authenticated',v_finish,'EXECUTE') OR
     NOT has_function_privilege('service_role',v_begin,'EXECUTE') OR NOT has_function_privilege('service_role',v_finish,'EXECUTE') THEN
    RAISE EXCEPTION 'RPC execute grants differ from the intended contract';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (v_begin,v_finish) AND prosecdef) THEN RAISE EXCEPTION 'RPC unexpectedly runs SECURITY DEFINER'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE oid IN (v_begin,v_finish) AND proconfig @> ARRAY['search_path=""']) <> 2 THEN
    RAISE EXCEPTION 'RPC search_path is not pinned empty';
  END IF;
END $$;

SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM id FROM public.ai_chat_sessions LIMIT 1;
    RAISE EXCEPTION 'authenticated role unexpectedly read session rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.ai_session_turn_begin('30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal',
      'MANAGER','CHATBOT',7,'browser forged question');
    RAISE EXCEPTION 'authenticated role unexpectedly invoked journal RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

CREATE FUNCTION public.dsh_assert_text(actual text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, received %', label, expected, actual; END IF; END $$;
CREATE FUNCTION public.dsh_assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION '%: expected true, received %', label, actual; END IF; END $$;
CREATE FUNCTION public.dsh_assert_false(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM false THEN RAISE EXCEPTION '%: expected false, received %', label, actual; END IF; END $$;

SET ROLE service_role;
-- Keep each state-changing RPC in its own autocommit transaction so later checks
-- observe committed state, just as separate HTTP requests do in production.
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000005:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'inactive member'), 'FORBIDDEN','inactive membership');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'inactive profile'), 'FORBIDDEN','inactive profile');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:ADMIN:CHATBOT:formal','ADMIN','CHATBOT',7,'role mismatch'), 'FORBIDDEN','mismatched role');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',6,'stale generation'), 'FORBIDDEN','stale generation');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'inactive workspace'), 'FORBIDDEN','inactive workspace');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000015',
    '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',3,'wrong workspace membership'), 'FORBIDDEN','wrong workspace membership');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000016','40000000-0000-4000-8000-000000000016',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003:TECHNICIAN:WORKSPACE:formal','TECHNICIAN','WORKSPACE',7,'technician native'), 'FORBIDDEN','technician native surface');

-- Technician read-only CHATBOT surface is allowed.
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000017','40000000-0000-4000-8000-000000000017',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003:TECHNICIAN:CHATBOT:formal','TECHNICIAN','CHATBOT',7,'technician chatbot'), 'RECORDED','technician chatbot');

-- Active requests are BUSY; old running turns are interrupted before replacement.
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000020',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'busy first'), 'RECORDED','initial busy fixture');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'busy second'), 'BUSY','active duplicate');
UPDATE public.ai_chat_turns SET created_at=clock_timestamp()-interval '66 seconds' WHERE id='40000000-0000-4000-8000-000000000020';
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000020','40000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'replacement'), 'RECORDED','stale replacement');
SELECT public.dsh_assert_true(EXISTS (SELECT 1 FROM public.ai_chat_turns WHERE id='40000000-0000-4000-8000-000000000020' AND status='INTERRUPTED' AND completed_at IS NOT NULL), 'stale running turn interrupted');

-- Turn cap is atomic and permits the fiftieth record only.
INSERT INTO public.ai_chat_sessions(id,workspace_id,profile_id,workspace_kind,generation,scope_key,role,surface,title,turn_count)
    VALUES ('30000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
      'DEMO',7,'20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT','cap test',49);
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000030',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'fiftieth'), 'RECORDED','fiftieth turn');
SELECT public.dsh_assert_true((SELECT turn_count=50 FROM public.ai_chat_sessions WHERE id='30000000-0000-4000-8000-000000000030'), 'turn count is 50');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000031',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'fifty-first'), 'LIMIT','fifty-first turn');
SELECT public.dsh_assert_true((SELECT turn_count=50 FROM public.ai_chat_sessions WHERE id='30000000-0000-4000-8000-000000000030'), 'turn count remains 50');

-- Terminal transition is compare-and-set for matching turn, scope and generation.
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000040','40000000-0000-4000-8000-000000000040',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'cas'), 'RECORDED','CAS fixture');
SELECT public.dsh_assert_false(public.ai_session_turn_finish('40000000-0000-4000-8000-000000000040','30000000-0000-4000-8000-000000000040','wrong-scope',7,'COMPLETED','answer',NULL,'[]'), 'wrong scope finish');
SELECT public.dsh_assert_false(public.ai_session_turn_finish('40000000-0000-4000-8000-000000000040','30000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal',8,'COMPLETED','answer',NULL,'[]'), 'wrong generation finish');
SELECT public.dsh_assert_true(public.ai_session_turn_finish('40000000-0000-4000-8000-000000000040','30000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal',7,'COMPLETED','server answer',NULL,'[]'), 'valid finish');
SELECT public.dsh_assert_false(public.ai_session_turn_finish('40000000-0000-4000-8000-000000000040','30000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal',7,'FAILED',NULL,NULL,'[]'), 'repeated finish');
SELECT public.dsh_assert_false(public.ai_session_turn_finish('40000000-0000-4000-8000-000000000040','30000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal',7,'RUNNING',NULL,NULL,'[]'), 'unsupported finish state');

-- Generation reset makes old turns unfinishable and rejects old-generation begins.
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000050','40000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'before reset'), 'RECORDED','reset fixture');
UPDATE public.workspaces SET generation=8 WHERE id='10000000-0000-4000-8000-000000000001';
SELECT public.dsh_assert_false(public.ai_session_turn_finish('40000000-0000-4000-8000-000000000050','30000000-0000-4000-8000-000000000050','20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal',7,'COMPLETED','stale output',NULL,'[]'), 'pre-reset output finish');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000051','40000000-0000-4000-8000-000000000051',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',7,'old generation'), 'FORBIDDEN','old generation begin');
SELECT public.dsh_assert_text(public.ai_session_turn_begin('30000000-0000-4000-8000-000000000052','40000000-0000-4000-8000-000000000052',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001:MANAGER:CHATBOT:formal','MANAGER','CHATBOT',8,'after reset'), 'RECORDED','current generation begin');
SELECT public.dsh_assert_true((SELECT count(*)=1 FROM public.ai_chat_sessions s JOIN public.workspaces w ON w.id=s.workspace_id
    WHERE s.workspace_id='10000000-0000-4000-8000-000000000001' AND s.generation=w.generation), 'only current generation session remains visible');
RESET ROLE;

\echo 'Synthetic identity, ACL, busy, stale-interrupt, cap, CAS and generation-reset assertions passed'
