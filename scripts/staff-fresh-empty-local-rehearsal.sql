-- Runs immediately after the real guarded installer SQL/catalog, before any
-- synthetic identity fixture. Managed Auth/Storage are local minimal stubs.
do $$declare v_table text; v_count bigint; v_signature text; begin
  if (select count(*) from public.workspaces)<>2 or (select count(*) from public.workspace_branches)<>2
    or (select count(*) from private.guest_ai_budget_policy where singleton and daily_limit=20)<>1
    or (select count(*) from auth.users)<>0 or (select count(*) from storage.objects)<>0 then
    raise exception 'FAIL: empty fresh catalog boundary'; end if;
  foreach v_table in array array['public.profiles','public.workspace_orders','public.workspace_memberships',
    'public.workspace_customers','public.workspace_technicians','public.audit_logs','public.ai_provider_configs',
    'public.ai_settings','public.knowledge_documents','private.staff_accounts','private.staff_provisioning',
    'private.staff_password_claims','private.owner_previews','private.staff_imports','private.staff_import_rows',
    'private.staff_password_resets'] loop
    execute 'select count(*) from '||v_table into v_count;
    if v_count<>0 then raise exception 'FAIL: copied application/credential state in %',v_table; end if;
  end loop;
  if (select count(*) from pg_policies where schemaname in ('public','private'))<>32
    or exists(select 1 from pg_constraint c join pg_namespace n on n.oid=c.connamespace
      where n.nspname in ('public','private') and c.contype='f' and not c.convalidated) then
    raise exception 'FAIL: fresh RLS/FK catalog'; end if;
  if (select count(*) from pg_tables where schemaname='public')<>20
    or (select count(*) from pg_tables where schemaname='private')<>13
    or not (select relrowsecurity from pg_class where oid='public.ai_chat_sessions'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.ai_chat_turns'::regclass)
    or (select count(*) from public.ai_chat_sessions)<>0 or (select count(*) from public.ai_chat_turns)<>0 then
    raise exception 'FAIL: expected 33 application tables including empty RLS-protected AI history'; end if;
  if has_table_privilege('anon','public.ai_chat_sessions','SELECT')
    or has_table_privilege('authenticated','public.ai_chat_turns','INSERT')
    or has_function_privilege('anon','public.ai_session_turn_begin(uuid,uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE')
    or has_function_privilege('authenticated','public.ai_session_turn_finish(uuid,uuid,text,integer,text,text,jsonb,jsonb)','EXECUTE')
    or not has_table_privilege('service_role','public.ai_chat_sessions','SELECT,INSERT,UPDATE')
    or not has_table_privilege('service_role','public.ai_chat_turns','SELECT,INSERT,UPDATE')
    or not has_function_privilege('service_role','public.ai_session_turn_begin(uuid,uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE')
    or not has_function_privilege('service_role','public.ai_session_turn_finish(uuid,uuid,text,integer,text,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'FAIL: fresh AI history ACL/RPC grants'; end if;
  if has_table_privilege('authenticated','public.workspace_orders','INSERT')
    or has_table_privilege('anon','public.workspace_orders','SELECT')
    or has_function_privilege('authenticated','private.staff_auth_password_fingerprint(uuid)','EXECUTE')
    or has_function_privilege('service_role','private.staff_auth_password_fingerprint(uuid)','EXECUTE') then
    raise exception 'FAIL: broad business/credential helper grant'; end if;
  foreach v_table in array array['staff_accounts','staff_provisioning','staff_password_claims','owner_previews',
    'staff_imports','staff_import_rows','staff_password_resets'] loop
    if has_table_privilege('authenticated','private.'||v_table,'SELECT')
      or has_table_privilege('authenticated','private.'||v_table,'INSERT')
      or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='private' and c.relname=v_table and c.relrowsecurity) then
      raise exception 'FAIL: private staff table boundary %',v_table; end if;
  end loop;
  foreach v_signature in array array[
    'public.staff_list(uuid,uuid,uuid)','public.staff_issue_password_claim(uuid,uuid,uuid)',
    'public.staff_complete_password_change(uuid,uuid,uuid,uuid)',
    'public.staff_reserve_password_reset(uuid,uuid,uuid,uuid,uuid,uuid)',
    'public.staff_finalize_password_reset(uuid,uuid,uuid,uuid,uuid,uuid)',
    'public.staff_preview_import(uuid,uuid,uuid,jsonb)',
    'public.staff_claim_import(uuid,uuid,uuid,uuid,boolean)',
    'public.staff_finish_import_batch(uuid,uuid,uuid,uuid,uuid,jsonb)'] loop
    if has_function_privilege('authenticated',v_signature,'EXECUTE')
      or not has_function_privilege('service_role',v_signature,'EXECUTE') then
      raise exception 'FAIL: service-only staff RPC %',v_signature; end if;
  end loop;
  if to_regprocedure('public.staff_complete_password_change(uuid,uuid,uuid)') is not null
    or to_regprocedure('public.workspace_assignment_proposal_approve(uuid,uuid,uuid)') is not null
    or to_regprocedure('public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[])') is not null then
    raise exception 'FAIL: superseded proof-free RPC survived'; end if;
  raise notice 'PASS: guarded fresh installer/catalog has no copied rows, 33 application tables, 32 policies, validated FKs, and restricted staff/AI-history grants';
end;$$;
select jsonb_build_object('publicTables',(select count(*) from pg_tables where schemaname='public'),
  'privateTables',(select count(*) from pg_tables where schemaname='private'),
  'publicRoutines',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
  'privateRoutines',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'),
  'policies',(select count(*) from pg_policies where schemaname in ('public','private')));
