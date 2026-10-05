-- Real PostgreSQL SQL/RLS execution, synthetic data and Auth claims only.
set row_security = on;
create temporary table fixture_ids as select
  gen_random_uuid() as staff_uid, gen_random_uuid() as owner_uid, gen_random_uuid() as guest_uid,
  gen_random_uuid() as technician_uid, gen_random_uuid() as staff_profile, gen_random_uuid() as owner_profile,
  gen_random_uuid() as guest_profile, gen_random_uuid() as technician_profile,
  (select id from public.workspaces where kind='OWNER') as owner_workspace,
  (select id from public.workspaces where kind='DEMO') as demo_workspace,
  gen_random_uuid() as owner_branch, gen_random_uuid() as demo_branch,
  gen_random_uuid() as owner_customer, gen_random_uuid() as demo_customer,
  gen_random_uuid() as technician_id, gen_random_uuid() as owner_order, gen_random_uuid() as demo_order,
  gen_random_uuid() as old_session, gen_random_uuid() as new_session, gen_random_uuid() as owner_session,
  gen_random_uuid() as document_id, gen_random_uuid() as version_id, gen_random_uuid() as proposal_id,
  gen_random_uuid() as guest_visit;
grant select on fixture_ids to authenticated,service_role;
create function pg_temp.assert_true(p_value boolean, p_label text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAIL: %',p_label; end if; end;
$$;

insert into auth.users(id,email) select staff_uid,'staff@local.example' from fixture_ids
  union all select owner_uid,'owner@local.example' from fixture_ids
  union all select guest_uid,'guest@local.example' from fixture_ids
  union all select technician_uid,'technician@local.example' from fixture_ids;
insert into auth.sessions(id,user_id,created_at) select old_session,staff_uid,clock_timestamp()-interval '1 hour' from fixture_ids;
insert into public.profiles(id,auth_user_id,display_name,role,platform_role,demo_principal)
  select staff_profile,staff_uid,'Synthetic Staff','ADMIN'::public.app_role,'USER'::public.platform_role,false from fixture_ids
  union all select owner_profile,owner_uid,'Synthetic Owner','ADMIN','SUPER_ADMIN',false from fixture_ids
  union all select guest_profile,guest_uid,'Synthetic Guest','ADMIN','USER',true from fixture_ids
  union all select technician_profile,technician_uid,'Synthetic Technician','TECHNICIAN','USER',false from fixture_ids;
insert into public.workspace_memberships(workspace_id,profile_id,role)
  select owner_workspace,staff_profile,'ADMIN'::public.app_role from fixture_ids
  union all select owner_workspace,owner_profile,'ADMIN' from fixture_ids
  union all select owner_workspace,technician_profile,'TECHNICIAN' from fixture_ids
  union all select demo_workspace,guest_profile,'ADMIN' from fixture_ids;
insert into private.staff_accounts(profile_id,auth_user_id,workspace_id,email)
  select staff_profile,staff_uid,owner_workspace,'staff@local.example' from fixture_ids;
insert into public.workspace_branches(workspace_id,id,code,name)
  select owner_workspace,owner_branch,'LOCAL_OWNER','Synthetic Owner branch' from fixture_ids
  union all select demo_workspace,demo_branch,'LOCAL_DEMO','Synthetic Demo branch' from fixture_ids;
insert into public.workspace_customers(workspace_id,id,name,address)
  select owner_workspace,owner_customer,'Synthetic Owner Customer','Fictional location' from fixture_ids
  union all select demo_workspace,demo_customer,'Synthetic Demo Customer','Fictional location' from fixture_ids;
insert into public.workspace_technicians(workspace_id,id,profile_id,branch_id)
  select owner_workspace,technician_id,technician_profile,owner_branch from fixture_ids;
insert into public.workspace_orders(workspace_id,id,order_no,branch_id,customer_id,problem_description,service_type,created_by_profile_id)
  select owner_workspace,owner_order,'LOCAL-OWNER',owner_branch,owner_customer,'Fictional leak','Inspection',staff_profile from fixture_ids
  union all select demo_workspace,demo_order,'LOCAL-DEMO',demo_branch,demo_customer,'Fictional leak','Inspection',guest_profile from fixture_ids;
insert into public.knowledge_documents(workspace_id,id,generation,title,source_label,created_by_profile_id)
  select owner_workspace,document_id,1,'Synthetic document','Synthetic source',staff_profile from fixture_ids;
insert into public.knowledge_versions(workspace_id,document_id,id,version_no,generation,source_text,sha256,index_state,chunk_count,created_by_profile_id)
  select owner_workspace,document_id,version_id,1,1,'Synthetic leak instructions',repeat('0',64),'READY',1,staff_profile from fixture_ids;
insert into public.knowledge_version_pages(workspace_id,document_id,version_id,page_no,content)
  select owner_workspace,document_id,version_id,1,'Synthetic leak instructions' from fixture_ids;
insert into public.knowledge_chunks(workspace_id,document_id,version_id,ordinal,section_label,content)
  select owner_workspace,document_id,version_id,1,'Synthetic section','Synthetic leak instructions' from fixture_ids;
insert into public.workspace_assignment_proposals(workspace_id,id,initiated_by_profile_id,idempotency_key,canonical_payload,target_order_id,target_updated_at,dataset_generation,expires_at)
  select f.owner_workspace,f.proposal_id,f.staff_profile,gen_random_uuid(),
    jsonb_build_object('orderId',f.owner_order,'technicianId',f.technician_id,'scheduledAt',null),
    f.owner_order,o.updated_at,1,clock_timestamp()+interval '1 hour'
  from fixture_ids f join public.workspace_orders o on o.id=f.owner_order;
insert into public.guest_visits(id,token_hash,workspace_id,persona,demo_generation,expires_at)
  select guest_visit,repeat('a',64),demo_workspace,'ADMIN',1,clock_timestamp()+interval '1 hour' from fixture_ids;

create function pg_temp.assert_business_reads(p_expected boolean) returns void language plpgsql as $$
declare v_table text; v_count integer;
begin
  foreach v_table in array array['workspaces','workspace_memberships','workspace_branches','workspace_customers',
    'workspace_technicians','workspace_orders','workspace_assignment_proposals','knowledge_documents',
    'knowledge_versions','knowledge_chunks','knowledge_version_pages'] loop
    execute format('select count(*) from public.%I',v_table) into v_count;
    perform pg_temp.assert_true((v_count > 0) = p_expected, v_table || ' readiness fence');
  end loop;
end;
$$;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.staff_uid,'session_id',f.old_session,'is_anonymous',false)::text,false);
end;$$;
set role authenticated;
do $$declare f record; v_status jsonb; begin
  select * into f from fixture_ids;
  v_status := public.staff_session_status();
  perform pg_temp.assert_true((v_status->>'isManaged')::boolean and (v_status->>'passwordChangeRequired')::boolean
    and (v_status->>'sessionAllowed')::boolean,'onboarding status remains usable');
  perform pg_temp.assert_business_reads(false);
  perform pg_temp.assert_true((select count(*)=1 from public.profiles),'onboarding self profile remains readable');
  begin
    perform public.workspace_order_create(f.owner_workspace,1,'PENDING-DENIED',f.owner_branch,f.owner_customer,'Fictional','Inspection',null,null);
    raise exception 'FAIL: temporary password command accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.knowledge_create_document(f.owner_workspace,1,'Denied','Synthetic');
    raise exception 'FAIL: temporary password knowledge command accepted';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_true(not has_table_privilege(current_user,'private.staff_accounts','SELECT'),'private staff state inaccessible');
  raise notice 'PASS: temporary-password status + 11 read denials + order/knowledge command denials';
end;$$;
reset role;
set role service_role;
do $$declare f record; begin
  select * into f from fixture_ids;
  begin perform public.workspace_assignment_proposal_approve(f.owner_workspace,f.proposal_id,f.staff_uid,f.old_session);
    raise exception 'FAIL: pending staff service approval accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.knowledge_issue_pdf_attestation(f.staff_uid,f.owner_workspace,1,f.document_id,array['Synthetic'],f.old_session);
    raise exception 'FAIL: pending staff PDF claim accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: temporary-password service approval/PDF denials';
end;$$;
reset role;
update private.staff_accounts set password_change_required=false where profile_id=(select staff_profile from fixture_ids);
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.assert_business_reads(true);
  perform pg_temp.assert_true((public.staff_session_status()->>'sessionAllowed')::boolean,'ready old session initially allowed');
  perform public.workspace_order_create(f.owner_workspace,1,'READY-ALLOWED',f.owner_branch,f.owner_customer,'Fictional','Inspection',null,null);
  perform public.knowledge_create_document(f.owner_workspace,1,'Ready knowledge','Synthetic');
  raise notice 'PASS: ready own-session 11 positive read roots + order/knowledge writes';
end;$$;
reset role;
set role service_role;
do $$declare f record; begin
  select * into f from fixture_ids;
  begin perform public.workspace_assignment_proposal_approve(f.owner_workspace,f.proposal_id,f.staff_uid);
    raise exception 'FAIL: ready staff approval without proof accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.knowledge_issue_pdf_attestation(f.staff_uid,f.owner_workspace,1,f.document_id,array['Synthetic']);
    raise exception 'FAIL: ready staff PDF without proof accepted';
  exception when insufficient_privilege then null; end;
  perform public.workspace_assignment_proposal_approve(f.owner_workspace,f.proposal_id,f.staff_uid,f.old_session);
  perform public.knowledge_issue_pdf_attestation(f.staff_uid,f.owner_workspace,1,f.document_id,array['Synthetic'],f.old_session);
  raise notice 'PASS: ready staff explicit-session service approval/PDF';
end;$$;
reset role;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.staff_uid,'is_anonymous',false)::text,false);
end;$$;
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'missing signed session claim denied');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.staff_uid,'session_id','invalid','is_anonymous',false)::text,false);
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'malformed signed session claim denied');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_uid,'session_id',f.old_session,'is_anonymous',false)::text,false);
  -- Owner is unmanaged; use the staff subject with a non-owned synthetic session below.
end;$$;
reset role;
insert into auth.sessions(id,user_id,created_at) select new_session,owner_uid,clock_timestamp() from fixture_ids;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.staff_uid,'session_id',f.new_session,'is_anonymous',false)::text,false);
end;$$;
set role authenticated;
do $$begin
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'foreign-user session denied');
end;$$;
reset role;
delete from auth.sessions where id=(select new_session from fixture_ids);
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=(select old_session from fixture_ids);
do $$declare f record; begin
  select * into f from fixture_ids;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.staff_uid,'session_id',f.old_session,'is_anonymous',false)::text,false);
end;$$;
set role authenticated;
do $$begin
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'expired session denied');
  raise notice 'PASS: missing/malformed/foreign/expired sessions denied';
end;$$;
reset role;
update auth.sessions set not_after=null where id=(select old_session from fixture_ids);
update public.workspace_memberships set role='MANAGER' where profile_id=(select staff_profile from fixture_ids);
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  begin perform public.workspace_order_create(f.owner_workspace,1,'ROLE-DENIED',f.owner_branch,f.owner_customer,'Fictional','Inspection',null,null);
    raise exception 'FAIL: old admin token retained create after role change';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: current membership role overrides old admin token';
end;$$;
reset role;
update public.workspace_memberships set role='ADMIN' where profile_id=(select staff_profile from fixture_ids);
update private.staff_accounts set sessions_valid_after=clock_timestamp(),auth_revision=gen_random_uuid()
  where profile_id=(select staff_profile from fixture_ids);
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.assert_business_reads(false);
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'old session cutoff denial');
  begin perform public.workspace_assignment_proposal_execute(f.owner_workspace,f.proposal_id);
    raise exception 'FAIL: old-session approved proposal executed';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: old-session cutoff, all read roots and approved execution denied';
end;$$;
reset role;
insert into auth.sessions(id,user_id,created_at) select new_session,staff_uid,clock_timestamp() from fixture_ids;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.staff_uid,'session_id',f.new_session,'is_anonymous',false)::text,false);
end;$$;
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.assert_business_reads(true);
  perform public.workspace_assignment_proposal_execute(f.owner_workspace,f.proposal_id);
  raise notice 'PASS: new post-cutoff session can read and execute approved proposal';
end;$$;
reset role;
update public.profiles set active=false where id=(select staff_profile from fixture_ids);
set role authenticated;
do $$begin
  perform pg_temp.assert_business_reads(false);
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'disabled profile fails status');
  raise notice 'PASS: disabled profile using previously valid session denied';
end;$$;
reset role;
update public.profiles set active=true where id=(select staff_profile from fixture_ids);
do $$declare f record; begin
  select * into f from fixture_ids;
  begin update public.profiles set platform_role='SUPER_ADMIN' where id=f.staff_profile;
    raise exception 'FAIL: staff promoted to platform Owner';
  exception when check_violation then null; end;
  begin insert into public.workspace_memberships(workspace_id,profile_id,role) values(f.demo_workspace,f.staff_profile,'ADMIN');
    raise exception 'FAIL: staff acquired second workspace';
  exception when check_violation then null; end;
  begin update private.staff_accounts set auth_user_id=f.owner_uid where profile_id=f.staff_profile;
    raise exception 'FAIL: staff auth identity changed';
  exception when check_violation then null; end;
  perform pg_temp.assert_true(to_regprocedure('public.workspace_assignment_proposal_approve(uuid,uuid,uuid)') is null,'old approval signature removed');
  perform pg_temp.assert_true(to_regprocedure('public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[])') is null,'old PDF signature removed');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_uid,'is_anonymous',false)::text,false);
  raise notice 'PASS: identity/membership invariants and legacy signature removal';
end;$$;
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.assert_true(not (public.staff_session_status()->>'isManaged')::boolean and
    (public.staff_session_status()->>'sessionAllowed')::boolean,'unmanaged Owner preserved');
  perform pg_temp.assert_true((select count(*)>0 from public.workspace_orders),'unmanaged Owner order visibility preserved');
  perform public.workspace_order_create(f.owner_workspace,1,'OWNER-ALLOWED',f.owner_branch,f.owner_customer,'Fictional','Inspection',null,null);
  raise notice 'PASS: unmanaged Owner reads/writes without new staff session dependency';
end;$$;
reset role;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.guest_uid,'is_anonymous',false)::text,false);
end;$$;
set role authenticated;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.assert_true(not (public.staff_session_status()->>'isManaged')::boolean and
    (public.staff_session_status()->>'sessionAllowed')::boolean,'unmanaged Guest principal preserved');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_orders),'Guest reads Demo only');
  perform public.workspace_order_create(f.demo_workspace,1,'GUEST-ALLOWED',f.demo_branch,f.demo_customer,'Fictional','Inspection',f.guest_visit,repeat('a',64));
  raise notice 'PASS: unmanaged Guest Demo reads/visit-bound write preserved';
end;$$;
reset role;
-- Synthetic cleanup-parent deletion exercises both FK cascade orders safely.
delete from auth.sessions where user_id=(select staff_uid from fixture_ids);
delete from auth.users where id=(select staff_uid from fixture_ids);
do $$begin
  perform pg_temp.assert_true((select count(*)=0 from private.staff_accounts),'Auth deletion cascades staff state');
  perform pg_temp.assert_true((select auth_user_id is null from public.profiles where id=(select staff_profile from fixture_ids)),
    'pre-existing profile Auth FK null cascade preserved');
  raise notice 'PASS: exact synthetic Auth parent deletion preserves FK cascade behavior';
end;$$;

-- Lifecycle extension: real application SQL, synthetic Auth rows only. These
-- local helper definers model admin.createUser/session creation without a provider.
create temporary table lifecycle_operations(role public.app_role,request_key uuid,input jsonb,reservation jsonb,account jsonb);
grant all on lifecycle_operations to service_role;
insert into auth.sessions(id,user_id,created_at) select owner_session,owner_uid,clock_timestamp() from fixture_ids;
create function pg_temp.owner_args() returns text language sql as $$
  select format('%L::uuid,%L::uuid,%L::uuid',owner_uid,owner_session,owner_workspace) from fixture_ids;
$$;
create function pg_temp.create_marked_auth(p_reservation jsonb,p_input jsonb,p_marked boolean default true)
returns void language plpgsql security definer as $$
begin
  insert into auth.users(id,email,raw_app_meta_data)
    values((p_reservation->>'targetAuthUserId')::uuid,p_input->>'email',
      case when p_marked then jsonb_build_object('sejukops_staff_operation',p_reservation->>'operationId') else '{}'::jsonb end);
end;
$$;
create function pg_temp.new_auth_session(p_user_id uuid) returns uuid language plpgsql security definer as $$
declare v_id uuid := gen_random_uuid();
begin insert into auth.sessions(id,user_id,created_at) values(v_id,p_user_id,clock_timestamp()); return v_id; end;
$$;
create function pg_temp.actor_ready(p_user_id uuid,p_workspace_id uuid,p_session_id uuid,p_pending boolean)
returns boolean language sql security definer as $$
  select private.staff_actor_ready(p_user_id,p_workspace_id,p_session_id,false,p_pending);
$$;
create function pg_temp.add_assigned_history(p_profile_id uuid)
returns void language sql security definer as $$
  insert into public.workspace_orders(workspace_id,order_no,branch_id,customer_id,assigned_technician_id,
    status,problem_description,service_type,created_by_profile_id)
  select f.owner_workspace,'LOCAL-LIFECYCLE-HISTORY',f.owner_branch,f.owner_customer,t.id,
    'ASSIGNED','Synthetic assigned history','Inspection',f.owner_profile
  from fixture_ids f join public.workspace_technicians t on t.workspace_id=f.owner_workspace and t.profile_id=p_profile_id;
$$;
create function pg_temp.expect_sqlstate(p_statement text,p_sqlstate text,p_label text)
returns void language plpgsql as $$
declare v_state text;
begin
  begin execute p_statement; raise exception 'FAIL: expected denial: %',p_label;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_sqlstate then raise exception 'FAIL: % SQLSTATE expected %, got %',p_label,p_sqlstate,v_state; end if;
  end;
end;
$$;
set role authenticated;
do $$declare v_signature text; begin
  foreach v_signature in array array[
    'public.staff_list(uuid,uuid,uuid)',
    'public.staff_reserve_creation(uuid,uuid,uuid,uuid,jsonb)',
    'public.staff_finalize_creation(uuid,uuid,uuid,uuid,uuid)',
    'public.staff_fail_creation(uuid,uuid,uuid,uuid,uuid)',
    'public.staff_update_account(uuid,uuid,uuid,uuid,uuid,public.app_role,text,boolean)',
    'public.staff_issue_password_claim(uuid,uuid,uuid)',
    'public.staff_complete_password_change(uuid,uuid,uuid,uuid)'] loop
    perform pg_temp.assert_true(not has_function_privilege(current_user,v_signature,'EXECUTE'),v_signature||' direct caller denied');
  end loop;
  perform pg_temp.expect_sqlstate(format('select public.staff_list(%s)',pg_temp.owner_args()),'42501','actual authenticated lifecycle call');
  raise notice 'PASS: all seven lifecycle/proof RPCs ungranted to authenticated; direct call denied';
end;$$;
reset role;
set role service_role;
do $$declare f record; begin
  select * into f from fixture_ids;
  perform pg_temp.expect_sqlstate(format('select public.staff_list(%L::uuid,null,%L::uuid)',f.owner_uid,f.owner_workspace),'42501','Owner missing session');
  perform pg_temp.expect_sqlstate(format('select public.staff_list(%L::uuid,%L::uuid,%L::uuid)',f.owner_uid,f.old_session,f.owner_workspace),'42501','Owner mismatched session');
  perform pg_temp.expect_sqlstate(format('select public.staff_list(%L::uuid,%L::uuid,%L::uuid)',f.technician_uid,f.owner_session,f.owner_workspace),'42501','ordinary user substituted as Owner');
  perform pg_temp.expect_sqlstate(format('select public.staff_list(%L::uuid,%L::uuid,%L::uuid)',f.owner_uid,f.owner_session,f.demo_workspace),'42501','Owner wrong workspace');
  perform pg_temp.assert_true(jsonb_array_length(public.staff_list(f.owner_uid,f.owner_session,f.owner_workspace)->'accounts')=0,'initial managed account list empty');
  raise notice 'PASS: service Owner proof rejects missing/mismatched session, ordinary principal and Demo workspace';
end;$$;

do $$declare f record; v_role public.app_role; v_input jsonb; v_request uuid; v_reservation jsonb; v_account jsonb; v_retry jsonb; begin
  select * into f from fixture_ids;
  foreach v_role in array array['ADMIN','MANAGER','TECHNICIAN']::public.app_role[] loop
    v_input := jsonb_build_object('name','Synthetic '||v_role,'email',lower(v_role::text)||'-new@local.example','role',v_role,
      'branchCode',case when v_role='TECHNICIAN' then 'LOCAL_OWNER' else null end);
    v_request := gen_random_uuid();
    v_reservation := public.staff_reserve_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,v_input);
    perform pg_temp.expect_sqlstate(format('select public.staff_reserve_creation(%s,%L::uuid,%L::jsonb)',pg_temp.owner_args(),v_request,v_input),'55P03','same-key in-flight retry');
    perform pg_temp.create_marked_auth(v_reservation,v_input);
    perform pg_temp.expect_sqlstate(format('select public.staff_finalize_creation(%s,%L::uuid,null)',pg_temp.owner_args(),v_request),'42501','NULL claim repair');
    perform pg_temp.expect_sqlstate(format('select public.staff_finalize_creation(%s,%L::uuid,%L::uuid)',pg_temp.owner_args(),v_request,gen_random_uuid()),'42501','wrong claim');
    v_account := public.staff_finalize_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,(v_reservation->>'claimToken')::uuid);
    v_retry := public.staff_finalize_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,(v_reservation->>'claimToken')::uuid);
    perform pg_temp.assert_true(v_account=v_retry,'finalize exact-claim idempotency');
    perform pg_temp.assert_true(public.staff_reserve_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,v_input)->>'state'='CREATED','created reservation retry');
    perform pg_temp.assert_true(v_account->>'role'=v_role::text and (v_account->>'passwordChangeRequired')::boolean,'correct permanent role and pending password');
    perform pg_temp.assert_true((select count(*)=1 from public.workspace_memberships where profile_id=(v_account->>'profileId')::uuid),'one workspace membership');
    perform pg_temp.assert_true((select platform_role='USER' and not demo_principal from public.profiles where id=(v_account->>'profileId')::uuid),'staff cannot be platform Owner/Guest');
    perform pg_temp.assert_true((select count(*)=1 from public.audit_logs where event_type='STAFF_ACCOUNT_CREATED' and idempotency_key=v_request::text),'one creation audit');
    if v_role='TECHNICIAN' then
      perform pg_temp.assert_true(v_account->>'branchCode'='LOCAL_OWNER','Technician active branch mapping');
    end if;
    insert into lifecycle_operations values(v_role,v_request,v_input,v_reservation,v_account);
    perform pg_temp.expect_sqlstate(format('select public.staff_reserve_creation(%s,%L::uuid,%L::jsonb)',pg_temp.owner_args(),v_request,v_input||'{"name":"changed"}'::jsonb),'23505','same-key changed input');
    perform pg_temp.expect_sqlstate(format('select public.staff_reserve_creation(%s,%L::uuid,%L::jsonb)',pg_temp.owner_args(),gen_random_uuid(),v_input),'23505','different-key email conflict');
  end loop;
  perform pg_temp.assert_true(jsonb_array_length(public.staff_list(f.owner_uid,f.owner_session,f.owner_workspace)->'accounts')=3,'list exact created accounts');
  raise notice 'PASS: three permanent roles reserve/finalize, duplicate key/finalize, exact audit, NULL/wrong claim, conflicting email and changed-input denials';
end;$$;

do $$declare f record; v_input jsonb; v_request uuid; v_reservation jsonb; v_retry jsonb; begin
  select * into f from fixture_ids;
  v_input := jsonb_build_object('name','Synthetic invalid','email','invalid@local.example','role','SUPER_ADMIN','branchCode',null);
  perform pg_temp.expect_sqlstate(format('select public.staff_reserve_creation(%s,%L::uuid,%L::jsonb)',pg_temp.owner_args(),gen_random_uuid(),v_input),'22023','platform-role input rejected');
  v_input := v_input||jsonb_build_object('role','TECHNICIAN','branchCode','MISSING_BRANCH');
  perform pg_temp.expect_sqlstate(format('select public.staff_reserve_creation(%s,%L::uuid,%L::jsonb)',pg_temp.owner_args(),gen_random_uuid(),v_input),'22023','invalid Technician branch');
  v_input := v_input||jsonb_build_object('role','ADMIN','branchCode',null,'email','owner@local.example');
  perform pg_temp.expect_sqlstate(format('select public.staff_reserve_creation(%s,%L::uuid,%L::jsonb)',pg_temp.owner_args(),gen_random_uuid(),v_input),'23505','existing Auth email never adopted');
  v_input := v_input||jsonb_build_object('email','unmarked@local.example');
  v_request := gen_random_uuid();
  v_reservation := public.staff_reserve_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,v_input);
  perform pg_temp.create_marked_auth(v_reservation,v_input,false);
  perform pg_temp.expect_sqlstate(format('select public.staff_finalize_creation(%s,%L::uuid,%L::uuid)',pg_temp.owner_args(),v_request,v_reservation->>'claimToken'),'42501','unmarked reserved Auth row denied');
  perform pg_temp.assert_true(not exists(select 1 from public.profiles where id=(v_reservation->>'targetProfileId')::uuid),'failed Auth marker creates no profile');
  perform public.staff_fail_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,(v_reservation->>'claimToken')::uuid);
  v_retry := public.staff_reserve_creation(f.owner_uid,f.owner_session,f.owner_workspace,v_request,v_input);
  perform pg_temp.assert_true(v_retry->>'claimToken'<>v_reservation->>'claimToken' and
    v_retry->>'targetAuthUserId'=v_reservation->>'targetAuthUserId','failed retry rotates claim and preserves reserved identity');
  perform pg_temp.expect_sqlstate(format('select public.staff_finalize_creation(%s,%L::uuid,%L::uuid)',pg_temp.owner_args(),v_request,v_reservation->>'claimToken'),'42501','stale claim rejected after retry');
  update private.staff_provisioning set created_at=clock_timestamp()-interval '1 hour',claim_expires_at=clock_timestamp()-interval '1 second' where id=v_request;
  perform pg_temp.expect_sqlstate(format('select public.staff_finalize_creation(%s,%L::uuid,%L::uuid)',pg_temp.owner_args(),v_request,v_retry->>'claimToken'),'40001','expired claim repair');
  perform pg_temp.assert_true(not exists(select 1 from public.profiles where id=(v_reservation->>'targetProfileId')::uuid),'expired claim creates no profile');
  raise notice 'PASS: invalid roles/branches, existing-email adoption, missing operation marker, stale/expired claims, failed retry identity binding';
end;$$;

do $$declare f record; op record; v_revision uuid; v_old_session uuid; v_updated jsonb; v_disabled jsonb; begin
  select * into f from fixture_ids; select * into op from lifecycle_operations where role='ADMIN';
  v_revision := (op.account->>'authRevision')::uuid;
  v_old_session := pg_temp.new_auth_session((op.reservation->>'targetAuthUserId')::uuid);
  perform pg_temp.expect_sqlstate(format('select public.staff_update_account(%s,%L::uuid,%L::uuid,%L::public.app_role,%L,true)',
    pg_temp.owner_args(),op.account->>'profileId',v_revision,'TECHNICIAN','MISSING_BRANCH'),'22023','update invalid branch');
  v_updated := public.staff_update_account(f.owner_uid,f.owner_session,f.owner_workspace,(op.account->>'profileId')::uuid,v_revision,'TECHNICIAN','LOCAL_OWNER',true);
  perform pg_temp.assert_true(v_updated->>'role'='TECHNICIAN' and v_updated->>'branchCode'='LOCAL_OWNER' and v_updated->>'authRevision'<>v_revision::text,'role update rotates revision and maps Technician');
  perform pg_temp.assert_true(not pg_temp.actor_ready((op.reservation->>'targetAuthUserId')::uuid,f.owner_workspace,v_old_session,true),'update cutoff denies pre-change session');
  perform pg_temp.expect_sqlstate(format('select public.staff_update_account(%s,%L::uuid,%L::uuid,%L::public.app_role,null,false)',
    pg_temp.owner_args(),op.account->>'profileId',v_revision,'ADMIN'),'40001','stale update revision');
  v_disabled := public.staff_update_account(f.owner_uid,f.owner_session,f.owner_workspace,(op.account->>'profileId')::uuid,(v_updated->>'authRevision')::uuid,'ADMIN',null,false);
  perform pg_temp.assert_true(not (v_disabled->>'active')::boolean and v_disabled->>'role'='ADMIN','disabled summary uses current role/active');
  perform pg_temp.assert_true((select not active from public.workspace_technicians where profile_id=(op.account->>'profileId')::uuid),'non-Technician mapping deactivated');
  perform pg_temp.expect_sqlstate(format('select public.staff_update_account(%s,%L::uuid,%L::uuid,%L::public.app_role,null,true)',
    pg_temp.owner_args(),f.owner_profile,gen_random_uuid(),'ADMIN'),'40001','cannot manage unmanaged Owner');
  raise notice 'PASS: update branch validation, role/mapping/revision, stale CAS, session cutoff, disabled state and unmanaged Owner protection';
end;$$;

reset role;
insert into public.workspace_branches(workspace_id,code,name)
  select owner_workspace,'LOCAL_OTHER','Synthetic second branch' from fixture_ids;
set role service_role;
do $$declare op record; v_revision uuid; begin
  select * into op from lifecycle_operations where role='TECHNICIAN';
  v_revision := (op.account->>'authRevision')::uuid;
  perform pg_temp.add_assigned_history((op.account->>'profileId')::uuid);
  perform pg_temp.expect_sqlstate(format('select public.staff_update_account(%s,%L::uuid,%L::uuid,%L::public.app_role,%L,true)',
    pg_temp.owner_args(),op.account->>'profileId',v_revision,'TECHNICIAN','LOCAL_OTHER'),'23514','assigned Technician branch-change domain denial');
  perform pg_temp.assert_true((select auth_revision=v_revision from private.staff_accounts where profile_id=(op.account->>'profileId')::uuid),'rejected branch change preserves revision');
  perform pg_temp.assert_true((select b.code='LOCAL_OWNER' from public.workspace_technicians t join public.workspace_branches b
    on b.workspace_id=t.workspace_id and b.id=t.branch_id where t.profile_id=(op.account->>'profileId')::uuid),'rejected branch change preserves mapping');
  raise notice 'PASS: assigned-history Technician branch change has stable denial and preserves mapping/revision';
end;$$;

-- Password completion with opaque pre-proof claim. Synthetic sessions model
-- Auth proof only; this does not exercise GoTrue or password cryptography.
reset role;
create function pg_temp.mock_auth_state(p_auth_user_id uuid,p_state text)
returns void language sql security definer as $$
  update auth.users set encrypted_password=p_state where id=p_auth_user_id;
$$;
create function pg_temp.proof_session(p_auth_user_id uuid,p_expected_state text)
returns uuid language plpgsql security definer as $$
begin
  if not exists(select 1 from auth.users where id=p_auth_user_id and encrypted_password=p_expected_state) then
    raise exception 'SYNTHETIC_PASSWORD_PROOF_FAILED' using errcode='28P01'; end if;
  return pg_temp.new_auth_session(p_auth_user_id);
end;
$$;
create function pg_temp.expire_password_claim(p_id uuid)
returns void language sql security definer as $$
  update private.staff_password_claims set created_at=clock_timestamp()-interval '91 seconds',expires_at=clock_timestamp()-interval '2 seconds' where id=p_id;
$$;
create function pg_temp.consume_password_claim(p_id uuid)
returns void language sql security definer as $$
  update private.staff_password_claims set consumed_at=clock_timestamp() where id=p_id;
$$;
create function pg_temp.self_status(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'session_id',p_session_id,'is_anonymous',false)::text,false);
  return public.staff_session_status();
end;
$$;
set role service_role;

do $$declare f record; op record; other_op record; v_uid uuid; v_revision uuid; v_original uuid; v_older uuid; v_proof uuid;
  v_claim jsonb; v_other_proof uuid; v_after private.staff_accounts;
begin
  select * into f from fixture_ids; select * into op from lifecycle_operations where role='MANAGER';
  select * into other_op from lifecycle_operations where role='TECHNICIAN';
  v_uid := (op.reservation->>'targetAuthUserId')::uuid; v_revision := (op.account->>'authRevision')::uuid;
  v_original := pg_temp.new_auth_session(v_uid); v_older := pg_temp.new_auth_session(v_uid);
  perform pg_temp.expect_sqlstate(format('select public.staff_issue_password_claim(%L::uuid,%L::uuid,%L::uuid)',v_uid,gen_random_uuid(),v_original),'42501','issue stale revision');
  perform pg_temp.expect_sqlstate(format('select public.staff_issue_password_claim(%L::uuid,%L::uuid,%L::uuid)',v_uid,v_revision,f.owner_session),'42501','issue foreign session');
  perform pg_temp.expect_sqlstate(format('select public.staff_issue_password_claim(%L::uuid,%L::uuid,null)',v_uid,v_revision),'42501','issue missing session');
  v_claim := public.staff_issue_password_claim(v_uid,v_revision,v_original);
  perform pg_temp.assert_true((v_claim - array['claimId','expiresAt'])='{}'::jsonb,'claim response contains no fingerprint or credential');
  v_proof := pg_temp.proof_session(v_uid,'synthetic');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,null)',v_uid,v_revision,v_proof),'42501','missing claim');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,gen_random_uuid(),v_proof,v_claim->>'claimId'),'42501','completion stale revision');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,v_revision,v_original,v_claim->>'claimId'),'42501','original session is not fresh proof');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,v_revision,v_older,v_claim->>'claimId'),'42501','different pre-claim session is not fresh proof');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,null,%L::uuid)',v_uid,v_revision,v_claim->>'claimId'),'42501','missing proof session');
  v_other_proof := pg_temp.new_auth_session((other_op.reservation->>'targetAuthUserId')::uuid);
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',other_op.reservation->>'targetAuthUserId',other_op.account->>'authRevision',v_other_proof,v_claim->>'claimId'),'42501','claim cannot complete another profile');
  perform public.staff_complete_password_change(v_uid,v_revision,v_proof,(v_claim->>'claimId')::uuid);
  select * into v_after from private.staff_accounts where profile_id=(op.account->>'profileId')::uuid;
  perform pg_temp.assert_true(not v_after.password_change_required and v_after.auth_revision<>v_revision,'completion clears pending and rotates revision');
  perform pg_temp.assert_true(not pg_temp.actor_ready(v_uid,f.owner_workspace,v_proof,false),'completion invalidates old session');
  v_original := pg_temp.new_auth_session(v_uid);
  perform pg_temp.assert_true(pg_temp.actor_ready(v_uid,f.owner_workspace,v_original,false),'fresh session business ready after completion');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,v_after.auth_revision,v_original,v_claim->>'claimId'),'42501','old claim cannot be reused');
  perform pg_temp.assert_true((select count(*)=1 from public.audit_logs where event_type='STAFF_PASSWORD_CHANGED' and actor_profile_id=(op.account->>'profileId')::uuid),'one completion audit');
  perform pg_temp.assert_true(to_regprocedure('public.staff_complete_password_change(uuid,uuid,uuid)') is null,'old proof-free completion signature removed');
  v_revision := v_after.auth_revision;
  v_claim := public.staff_issue_password_claim(v_uid,v_revision,v_original);
  v_proof := pg_temp.new_auth_session(v_uid);
  perform pg_temp.consume_password_claim((v_claim->>'claimId')::uuid);
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,v_revision,v_proof,v_claim->>'claimId'),'42501','consumed claim denied with otherwise current revision');
  v_claim := public.staff_issue_password_claim(v_uid,v_revision,v_original);
  v_proof := pg_temp.new_auth_session(v_uid);
  perform pg_temp.expire_password_claim((v_claim->>'claimId')::uuid);
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,v_revision,v_proof,v_claim->>'claimId'),'42501','expired claim denied');
  raise notice 'PASS: opaque claim completion current-state/CAS, fresh proof, wrong profile/revision, missing/original/old session, consumed/reused/expired claims';
end;$$;

do $$declare f record; op record; v_uid uuid; v_revision uuid; v_original uuid; v_proof uuid; v_claim jsonb; v_status jsonb;
begin
  select * into f from fixture_ids; select * into op from lifecycle_operations where role='MANAGER';
  v_uid := (op.reservation->>'targetAuthUserId')::uuid;
  select auth_revision into v_revision from private.staff_accounts where auth_user_id=v_uid;
  v_original := pg_temp.new_auth_session(v_uid);
  -- A late older reset before claim issuance makes desired-new-password proof
  -- fail at the synthetic Auth oracle; claim issuance alone grants no business access.
  perform pg_temp.mock_auth_state(v_uid,'synthetic-intended-one');
  perform pg_temp.mock_auth_state(v_uid,'synthetic-late-one');
  v_claim := public.staff_issue_password_claim(v_uid,v_revision,v_original);
  perform pg_temp.expect_sqlstate(format('select pg_temp.proof_session(%L::uuid,%L)',v_uid,'synthetic-intended-one'),'28P01','late Auth mutation before claim defeats desired password proof');
  perform pg_temp.assert_true(not pg_temp.actor_ready(v_uid,f.owner_workspace,v_original,false),'late pre-claim mutation denies business');
  -- A late reset after desired-password proof but before completion must fail
  -- fingerprint equality against the pre-proof claim, without rotating revision.
  perform pg_temp.mock_auth_state(v_uid,'synthetic-intended-two');
  v_claim := public.staff_issue_password_claim(v_uid,v_revision,v_original);
  v_proof := pg_temp.proof_session(v_uid,'synthetic-intended-two');
  perform pg_temp.mock_auth_state(v_uid,'synthetic-late-two');
  perform pg_temp.expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',v_uid,v_revision,v_proof,v_claim->>'claimId'),'42501','late mutation between proof and completion');
  perform pg_temp.assert_true((select auth_revision=v_revision from private.staff_accounts where auth_user_id=v_uid),'failed late-write completion preserves revision');
  -- Complete one current state, obtain a post-cutoff session, then mutate Auth
  -- again: readiness and public/Owner summaries must derive pending onboarding.
  perform pg_temp.mock_auth_state(v_uid,'synthetic-intended-three');
  v_claim := public.staff_issue_password_claim(v_uid,v_revision,v_original);
  v_proof := pg_temp.proof_session(v_uid,'synthetic-intended-three');
  perform public.staff_complete_password_change(v_uid,v_revision,v_proof,(v_claim->>'claimId')::uuid);
  v_original := pg_temp.new_auth_session(v_uid);
  perform pg_temp.assert_true(pg_temp.actor_ready(v_uid,f.owner_workspace,v_original,false),'normal changed Auth state becomes ready');
  perform pg_temp.mock_auth_state(v_uid,'synthetic-late-three');
  v_status := pg_temp.self_status(v_uid,v_original);
  perform pg_temp.assert_true((v_status->>'passwordChangeRequired')::boolean and (v_status->>'sessionAllowed')::boolean,
    'late post-completion Auth mutation requires onboarding while live session remains valid');
  perform pg_temp.assert_true(not pg_temp.actor_ready(v_uid,f.owner_workspace,v_original,false),'late post-completion mutation denies business');
  perform pg_temp.assert_true((select (a->>'passwordChangeRequired')::boolean from jsonb_array_elements(
    public.staff_list(f.owner_uid,f.owner_session,f.owner_workspace)->'accounts') a where a->>'profileId'=op.account->>'profileId'),
    'Owner summary derives pending from Auth mismatch');
  raise notice 'PASS: Auth mutations before claim, between proof/completion and after completion; derived pending summary';
end;$$;
reset role;
set role authenticated;
do $$begin
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_orders),'late Auth mismatch denies actual order RLS reads');
  perform pg_temp.assert_true(not has_table_privilege(current_user,'private.staff_password_claims','SELECT'),'claims and equality sentinel not caller-readable');
  raise notice 'PASS: late Auth mismatch direct RLS denial and private claims inaccessible';
end;$$;
reset role;
set role service_role;
do $$declare f record; op record; v_uid uuid; v_session uuid; v_revision uuid; begin
  select * into f from fixture_ids; select * into op from lifecycle_operations where role='MANAGER';
  v_uid := (op.reservation->>'targetAuthUserId')::uuid;
  select auth_revision into v_revision from private.staff_accounts where auth_user_id=v_uid;
  v_session := pg_temp.new_auth_session(v_uid);
  perform pg_temp.mock_auth_state(v_uid,'');
  perform pg_temp.assert_true(not pg_temp.actor_ready(v_uid,f.owner_workspace,v_session,true),'empty Auth hash fails closed even for onboarding');
  perform pg_temp.expect_sqlstate(format('select public.staff_issue_password_claim(%L::uuid,%L::uuid,%L::uuid)',v_uid,
    v_revision,v_session),'42501','empty Auth state cannot issue a claim');
  raise notice 'PASS: empty Auth state fails closed for session readiness and claim issuance';
end;$$;
reset role;
