-- Executed only in the disposable local synthetic cluster. No real JWT/Auth.
set row_security=on;
create temporary table preview_fixture as select
  (select id from public.workspaces where kind='OWNER') as workspace_id,
  (select id from public.workspaces where kind='DEMO') as demo_workspace,
  gen_random_uuid() as owner_uid,gen_random_uuid() as owner_profile,gen_random_uuid() as owner_session,
  gen_random_uuid() as other_session,gen_random_uuid() as tech_a_uid,gen_random_uuid() as tech_b_uid,
  gen_random_uuid() as tech_a_profile,gen_random_uuid() as tech_b_profile,
  gen_random_uuid() as tech_a_id,gen_random_uuid() as tech_b_id,
  gen_random_uuid() as tech_a_session,gen_random_uuid() as branch_a,gen_random_uuid() as branch_b,
  gen_random_uuid() as customer_a,gen_random_uuid() as customer_b,gen_random_uuid() as customer_new,
  gen_random_uuid() as order_a,gen_random_uuid() as order_b,gen_random_uuid() as order_new,
  gen_random_uuid() as published_doc,gen_random_uuid() as published_version,
  gen_random_uuid() as draft_doc,gen_random_uuid() as draft_version,
  gen_random_uuid() as own_proposal,gen_random_uuid() as foreign_proposal,
  gen_random_uuid() as pdf_token;
grant select,update on preview_fixture to authenticated,service_role;
create function pg_temp.assert_true(p_value boolean,p_label text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAIL: %',p_label; end if; end;$$;
create function pg_temp.expect_denial(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
declare v_state text;
begin begin execute p_sql; raise exception 'FAIL: expected denial %',p_label;
  exception when others then get stacked diagnostics v_state=returned_sqlstate;
    if v_state<>p_state then raise exception 'FAIL: % expected %, got %',p_label,p_state,v_state; end if;
  end;
end;$$;
create function pg_temp.subject(p_uid uuid,p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'session_id',p_session,'is_anonymous',false)::text,false);
$$;
insert into auth.users(id,email) select owner_uid,'preview-owner@local.example' from preview_fixture
  union all select tech_a_uid,'preview-a@local.example' from preview_fixture
  union all select tech_b_uid,'preview-b@local.example' from preview_fixture;
insert into auth.sessions(id,user_id) select owner_session,owner_uid from preview_fixture
  union all select other_session,owner_uid from preview_fixture
  union all select tech_a_session,tech_a_uid from preview_fixture;
insert into public.profiles(id,auth_user_id,display_name,role,platform_role)
  select owner_profile,owner_uid,'Preview actual Owner','ADMIN'::public.app_role,'SUPER_ADMIN'::public.platform_role from preview_fixture
  union all select tech_a_profile,tech_a_uid,'Preview Employee A','TECHNICIAN','USER' from preview_fixture
  union all select tech_b_profile,tech_b_uid,'Preview Employee B','TECHNICIAN','USER' from preview_fixture;
insert into public.workspace_memberships(workspace_id,profile_id,role)
  select workspace_id,owner_profile,'ADMIN'::public.app_role from preview_fixture
  union all select workspace_id,tech_a_profile,'TECHNICIAN' from preview_fixture
  union all select workspace_id,tech_b_profile,'TECHNICIAN' from preview_fixture;
insert into private.staff_accounts(profile_id,auth_user_id,workspace_id,email,password_change_required)
  select tech_a_profile,tech_a_uid,workspace_id,'preview-a@local.example',false from preview_fixture
  union all select tech_b_profile,tech_b_uid,workspace_id,'preview-b@local.example',false from preview_fixture;
insert into public.workspace_branches(workspace_id,id,code,name)
  select workspace_id,branch_a,'PREVIEW-A','Preview branch A' from preview_fixture
  union all select workspace_id,branch_b,'PREVIEW-B','Preview branch B' from preview_fixture;
insert into public.workspace_technicians(workspace_id,id,profile_id,branch_id)
  select workspace_id,tech_a_id,tech_a_profile,branch_a from preview_fixture
  union all select workspace_id,tech_b_id,tech_b_profile,branch_b from preview_fixture;
insert into public.workspace_customers(workspace_id,id,name,address)
  select workspace_id,customer_a,'Preview Customer A','Fictional A' from preview_fixture
  union all select workspace_id,customer_b,'Preview Customer B','Fictional B' from preview_fixture
  union all select workspace_id,customer_new,'Preview Unassigned Customer','Fictional unassigned' from preview_fixture;
insert into public.workspace_orders(workspace_id,id,order_no,branch_id,customer_id,assigned_technician_id,status,
  problem_description,service_type,created_by_profile_id)
  select workspace_id,order_a,'PREVIEW-A',branch_a,customer_a,tech_a_id,'ASSIGNED'::public.service_order_status,'Synthetic leak','Inspection',owner_profile from preview_fixture
  union all select workspace_id,order_b,'PREVIEW-B',branch_b,customer_b,tech_b_id,'ASSIGNED','Synthetic leak','Inspection',owner_profile from preview_fixture
  union all select workspace_id,order_new,'PREVIEW-NEW',branch_a,customer_new,null,'NEW','Synthetic leak','Inspection',owner_profile from preview_fixture;
insert into public.knowledge_documents(workspace_id,id,generation,title,source_label,created_by_profile_id)
  select workspace_id,published_doc,1,'Preview Published','Synthetic',owner_profile from preview_fixture
  union all select workspace_id,draft_doc,1,'Preview Draft','Synthetic',owner_profile from preview_fixture;
insert into public.knowledge_versions(workspace_id,document_id,id,version_no,generation,source_text,sha256,index_state,chunk_count,created_by_profile_id)
  select workspace_id,published_doc,published_version,1,1,'Synthetic published leak',repeat('0',64),'READY'::public.knowledge_index_state,1,owner_profile from preview_fixture
  union all select workspace_id,draft_doc,draft_version,1,1,'Synthetic draft leak',repeat('0',64),'READY',1,owner_profile from preview_fixture;
insert into public.knowledge_version_pages(workspace_id,document_id,version_id,page_no,content)
  select workspace_id,published_doc,published_version,1,'Synthetic published leak' from preview_fixture
  union all select workspace_id,draft_doc,draft_version,1,'Synthetic draft leak' from preview_fixture;
insert into public.knowledge_chunks(workspace_id,document_id,version_id,ordinal,section_label,content)
  select workspace_id,published_doc,published_version,1,'Synthetic','Synthetic published leak' from preview_fixture
  union all select workspace_id,draft_doc,draft_version,1,'Synthetic','Synthetic draft leak' from preview_fixture;
update public.knowledge_documents d set state='PUBLISHED',published_version_id=f.published_version
  from preview_fixture f where d.id=f.published_doc;
insert into public.workspace_assignment_proposals(workspace_id,id,initiated_by_profile_id,idempotency_key,
  canonical_payload,target_order_id,target_updated_at,dataset_generation,expires_at)
  select f.workspace_id,f.own_proposal,f.owner_profile,gen_random_uuid(),
    jsonb_build_object('orderId',f.order_new,'technicianId',f.tech_a_id,'scheduledAt',null),f.order_new,o.updated_at,1,clock_timestamp()+interval '1 hour'
    from preview_fixture f join public.workspace_orders o on o.id=f.order_new
  union all select f.workspace_id,f.foreign_proposal,f.tech_a_profile,gen_random_uuid(),
    jsonb_build_object('orderId',f.order_new,'technicianId',f.tech_a_id,'scheduledAt',null),f.order_new,o.updated_at,1,clock_timestamp()+interval '1 hour'
    from preview_fixture f join public.workspace_orders o on o.id=f.order_new;
do $$declare f record; begin select * into f from preview_fixture;
  perform pg_temp.subject(f.owner_uid,f.owner_session);
  update preview_fixture set pdf_token=public.knowledge_issue_pdf_attestation(f.owner_uid,f.workspace_id,1,f.draft_doc,array['Synthetic PDF'],f.owner_session);
end;$$;
set role authenticated;
do $$declare f record; v jsonb; begin select * into f from preview_fixture;
  perform pg_temp.assert_true(public.owner_preview_status(f.workspace_id) is null,'initial status null');
  perform pg_temp.assert_true(jsonb_array_length(public.owner_preview_options(f.workspace_id)->'technicians')>=2,'formal employee options');
  perform pg_temp.assert_true(not has_table_privilege(current_user,'private.owner_previews','SELECT'),'private previews inaccessible');
  perform pg_temp.expect_denial(format('select public.owner_preview_set(%L::uuid,''ADMIN'',%L::uuid)',f.workspace_id,f.tech_a_profile),'22023','Admin employee forbidden');
  perform pg_temp.expect_denial(format('select public.owner_preview_set(%L::uuid,''TECHNICIAN'',null)',f.workspace_id),'22023','Technician employee required');
  perform pg_temp.expect_denial(format('select public.owner_preview_set(%L::uuid,''TECHNICIAN'',%L::uuid)',f.workspace_id,f.owner_profile),'22023','Owner cannot be employee');
  perform pg_temp.expect_denial(format('select public.owner_preview_set(%L::uuid,''ADMIN'',null)',f.demo_workspace),'42501','Demo workspace forbidden');
  perform pg_temp.subject(f.tech_a_uid,f.tech_a_session);
  perform pg_temp.expect_denial(format('select public.owner_preview_set(%L::uuid,''ADMIN'',null)',f.workspace_id),'42501','ordinary staff cannot preview');
  perform pg_temp.subject(f.owner_uid,f.tech_a_session);
  perform pg_temp.expect_denial(format('select public.owner_preview_status(%L::uuid)',f.workspace_id),'42501','foreign session forbidden');
  perform pg_temp.subject(f.owner_uid,null);
  perform pg_temp.expect_denial(format('select public.owner_preview_options(%L::uuid)',f.workspace_id),'42501','missing signed session forbidden');
  perform pg_temp.subject(f.owner_uid,f.owner_session);
  v:=public.owner_preview_set(f.workspace_id,'TECHNICIAN',f.tech_a_profile);
  perform pg_temp.assert_true(v->>'role'='TECHNICIAN' and (v->>'effectiveEmployeeProfileId')::uuid=f.tech_a_profile
    and v->>'effectiveEmployeeName'='Preview Employee A' and (v->>'readOnly')::boolean,'strict actual employee response');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_orders),'Tech A only assigned order');
  perform pg_temp.assert_true((select id=f.order_a from public.workspace_orders),'Tech A exact order');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_customers),'Tech A customer scope');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_technicians),'Tech A mapping scope');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_branches),'Tech A branch scope');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_assignment_proposals),'Tech no proposals');
  perform pg_temp.assert_true((select count(*)=1 from public.knowledge_documents where id in (f.published_doc,f.draft_doc)),'published KB document only');
  perform pg_temp.assert_true((select count(*)=1 from public.knowledge_versions where document_id in (f.published_doc,f.draft_doc)),'published READY version only');
  perform pg_temp.assert_true((select count(*)=1 from public.knowledge_chunks where document_id in (f.published_doc,f.draft_doc)),'published chunks only');
  perform pg_temp.assert_true((select count(*)=1 from public.knowledge_version_pages where document_id in (f.published_doc,f.draft_doc)),'published pages only');
  perform pg_temp.assert_true((select id=f.owner_profile from public.profiles),'actual Owner self profile retained');
  perform pg_temp.assert_true((select profile_id=f.owner_profile from public.workspace_memberships),'actual Owner membership lookup retained');
  raise notice 'PASS: signed Owner/selection negatives + Tech A direct RLS scope + published KB + actual identity';
end;$$;

-- Actual public command entrypoints, including the legacy signatures and intake.
do $$declare f record; v_sql text; v_before integer; begin select * into f from preview_fixture;
  select count(*) into v_before from public.workspace_orders;
  foreach v_sql in array array[
    format('select public.workspace_order_create(%L,1,''DENIED'',%L,%L,''Synthetic'',''Inspection'')',f.workspace_id,f.branch_a,f.customer_a),
    format('select public.workspace_order_create(%L,1,''DENIED'',%L,%L,''Synthetic'',''Inspection'',null,null)',f.workspace_id,f.branch_a,f.customer_a),
    format('select public.workspace_order_create_with_customer(%L,1,''DENIED'',%L,''Synthetic'',null,''Fictional'',''Leak'',''Inspection'')',f.workspace_id,f.branch_a),
    format('select public.workspace_order_create_with_customer(%L,1,''DENIED'',%L,''Synthetic'',null,''Fictional'',''Leak'',''Inspection'',null,null)',f.workspace_id,f.branch_a),
    format('select public.workspace_order_assign(%L,1,%L,%L,now(),null)',f.workspace_id,f.order_new,f.tech_a_id),
    format('select public.workspace_order_assign(%L,1,%L,%L,now(),null,null,null)',f.workspace_id,f.order_new,f.tech_a_id),
    format('select public.workspace_order_manager_reschedule(%L,1,%L,now(),now(),null,null)',f.workspace_id,f.order_a),
    format('select public.workspace_order_technician_transition(%L,1,%L,now(),''IN_PROGRESS'',null,null)',f.workspace_id,f.order_a),
    format('select public.workspace_assignment_proposal_create(%L,%L,%L,now(),null,gen_random_uuid())',f.workspace_id,f.order_new,f.tech_a_id),
    format('select public.workspace_assignment_proposal_execute(%L,%L)',f.workspace_id,f.own_proposal),
    format('select public.knowledge_create_document(%L,1,''Denied'',''Synthetic'')',f.workspace_id),
    format('select public.knowledge_archive(%L,1,%L)',f.workspace_id,f.published_doc),
    format('select public.knowledge_publish(%L,1,%L,%L)',f.workspace_id,f.draft_doc,f.draft_version),
    format('select public.knowledge_stage_text(%L,1,%L,''Synthetic'',array[''Synthetic''])',f.workspace_id,f.draft_doc),
    format('select public.knowledge_claim_index(%L,1,%L,%L)',f.workspace_id,f.draft_doc,f.draft_version),
    format('select public.knowledge_retry_index(%L,1,%L,%L)',f.workspace_id,f.draft_doc,f.draft_version),
    format('select public.knowledge_fail_index(%L,1,%L,%L,gen_random_uuid(),''SYNTHETIC'')',f.workspace_id,f.draft_doc,f.draft_version),
    format('select public.knowledge_finish_index(%L,1,%L,%L,gen_random_uuid(),array[1],array[''Synthetic''])',f.workspace_id,f.draft_doc,f.draft_version),
    format('select public.knowledge_consume_pdf_attestation(%L,array[''Synthetic PDF''])',f.pdf_token)
  ] loop perform pg_temp.expect_denial(v_sql,'42501','preview public command: '||split_part(v_sql,'(',1)); end loop;
  perform pg_temp.assert_true((select count(*)=v_before from public.workspace_orders),'no write side effect');
  raise notice 'PASS: 19 authenticated business entrypoints deny under preview';
end;$$;
reset role;
set role service_role;
do $$declare f record; v_session uuid; begin select * into f from preview_fixture;
  foreach v_session in array array[f.owner_session,null::uuid] loop
    perform pg_temp.expect_denial(format('select public.workspace_assignment_proposal_approve(%L,%L,%L,%L)',f.workspace_id,f.own_proposal,f.owner_uid,v_session),'42501','service approval preview');
    perform pg_temp.expect_denial(format('select public.knowledge_issue_pdf_attestation(%L,%L,1,%L,array[''Synthetic''],%L)',f.owner_uid,f.workspace_id,f.draft_doc,v_session),'42501','service PDF preview');
  end loop;
  perform pg_temp.expect_denial(format('select public.workspace_assignment_proposal_create_mcp(%L,%L,%L,now(),null,gen_random_uuid(),%L)',f.workspace_id,f.order_new,f.tech_a_id,f.owner_uid),'42501','service proof-free MCP preview');
  raise notice 'PASS: approval/PDF explicit + omitted proof and proof-free MCP deny';
end;$$;
reset role;
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform public.owner_preview_set(f.workspace_id,'TECHNICIAN',f.tech_b_profile);
  perform pg_temp.assert_true((select id=f.order_b from public.workspace_orders),'Tech B actual employee switch');
  perform public.owner_preview_set(f.workspace_id,'MANAGER');
  perform pg_temp.assert_true((select count(*)=3 from public.workspace_orders where id in(f.order_a,f.order_b,f.order_new)),'Manager existing all-orders contract');
  perform pg_temp.assert_true((select count(*)=3 from public.workspace_customers where id in(f.customer_a,f.customer_b,f.customer_new)),'Manager all customers');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_assignment_proposals where id in(f.own_proposal,f.foreign_proposal)),'Manager actual Owner participant only');
  perform public.owner_preview_set(f.workspace_id,'ADMIN');
  perform pg_temp.assert_true(public.owner_preview_status(f.workspace_id)->>'role'='ADMIN','Admin status exact');
  perform pg_temp.assert_true((select count(*)=3 from public.workspace_orders where id in(f.order_a,f.order_b,f.order_new)),'Admin all orders');
  perform public.owner_preview_set(f.workspace_id,'TECHNICIAN',f.tech_a_profile);
  raise notice 'PASS: employee A/B selection + Manager/Admin existing read contract';
end;$$;
reset role;
-- Employee changes invalidate both status and reads; stale state never restores Admin.
update public.workspace_technicians set active=false where id=(select tech_a_id from preview_fixture);
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform pg_temp.expect_denial(format('select public.owner_preview_status(%L)',f.workspace_id),'42501','inactive employee status fails closed');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_orders),'inactive employee read denial');
  perform pg_temp.expect_denial(format('select public.owner_preview_set(%L,''ADMIN'')',f.workspace_id),'42501','invalid preview requires exit before set');
  perform pg_temp.assert_true(public.owner_preview_exit(),'exit invalid employee preview');
  perform pg_temp.assert_true(public.owner_preview_status(f.workspace_id) is null,'exit restores ordinary status');
  perform pg_temp.assert_true((select count(*)=3 from public.workspace_orders where id in(f.order_a,f.order_b,f.order_new)),'exit restores actual Owner reads');
  perform public.workspace_order_create(f.workspace_id,1,'PREVIEW-EXIT-WRITE',f.branch_b,f.customer_b,'Synthetic','Inspection',null,null);
  raise notice 'PASS: invalid employee fails closed until exit; Owner reads/writes restored';
end;$$;
reset role;
update public.workspace_technicians set active=true where id=(select tech_a_id from preview_fixture);
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture; perform public.owner_preview_set(f.workspace_id,'TECHNICIAN',f.tech_a_profile); end;$$;
reset role;
update private.owner_previews set created_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour'
  where session_id=(select owner_session from preview_fixture);
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform pg_temp.expect_denial(format('select public.owner_preview_status(%L)',f.workspace_id),'42501','expired status fails closed');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_orders),'expired preview RLS denied');
  perform pg_temp.expect_denial(format('select public.workspace_order_create(%L,1,''EXPIRED-DENIED'',%L,%L,''Synthetic'',''Inspection'',null,null)',f.workspace_id,f.branch_a,f.customer_a),'42501','expired preview still write-blocking');
  perform pg_temp.assert_true(public.owner_preview_exit(),'explicit exit expired preview');
  perform pg_temp.assert_true(not public.owner_preview_exit(),'no-op exit false');
  perform pg_temp.subject(f.tech_a_uid,f.tech_a_session);
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_orders),'formal Tech A own orders outside preview');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_customers),'formal Tech A own assigned customers');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_technicians),'formal Tech A directory self only');
  perform pg_temp.assert_true((select count(*)=1 from public.workspace_branches),'formal Tech A own branch only');
  raise notice 'PASS: expired preview fails closed; explicit exit; normal formal Technician direct RLS scope';
end;$$;
reset role;
-- Only retained in this disposable synthetic cluster for the two-connection
-- transition runner. No fixture table is created in a migration or hosted DB.
create schema rehearsal;
create table rehearsal.preview_fixture as select * from preview_fixture;
do $$declare f record; v_guest_uid uuid; begin select * into f from preview_fixture;
  perform pg_temp.assert_true((select count(*)=6 from public.audit_logs where event_type='OWNER_PREVIEW_STARTED'
    and actor_profile_id=f.owner_profile and (metadata_json->>'actualOwnerProfileId')::uuid=f.owner_profile
    and (metadata_json->>'actualOwnerAuthUserId')::uuid=f.owner_uid and (metadata_json->>'workspaceId')::uuid=f.workspace_id),'actual Owner preview begin audit context');
  perform pg_temp.assert_true((select count(*)=6 from public.audit_logs where event_type='OWNER_PREVIEW_ENDED' and actor_profile_id=f.owner_profile),'one end audit per begun preview');
  select p.auth_user_id into v_guest_uid from public.profiles p where p.demo_principal and p.role='ADMIN' and p.active limit 1;
  perform pg_temp.subject(v_guest_uid,null);
end;$$;
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform pg_temp.assert_true((select count(*)>0 from public.workspace_orders where workspace_id=f.demo_workspace),'unmanaged Demo Guest preserved');
  raise notice 'PASS: actual Owner/effective employee audit context + unmanaged Guest reads preserved';
end;$$;
reset role;

-- Auth session deletion cascades preview state, but supplied revoked Owner proof
-- still denies business. A different fresh session retains ordinary Owner access.
do $$declare f record; begin select * into f from preview_fixture; perform pg_temp.subject(f.owner_uid,f.owner_session); end;$$;
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform public.owner_preview_set(f.workspace_id,'ADMIN');
end;$$;
reset role;
delete from auth.sessions where id=(select owner_session from preview_fixture);
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'deleted Owner session status denied');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_orders),'deleted Owner supplied session direct RLS denied');
  perform pg_temp.expect_denial(format('select public.workspace_order_create(%L,1,''LOGOUT-DENIED'',%L,%L,''Synthetic'',''Inspection'',null,null)',f.workspace_id,f.branch_a,f.customer_a),'42501','preview cascade cannot restore revoked Owner command');
  perform pg_temp.subject(f.owner_uid,f.other_session);
  perform pg_temp.assert_true((public.staff_session_status()->>'sessionAllowed')::boolean,'fresh other Owner session status allowed');
  perform public.workspace_order_create(f.workspace_id,1,'OWNER-FRESH-ALLOWED',f.branch_b,f.customer_b,'Synthetic','Inspection',null,null);
  raise notice 'PASS: preview cascade + deleted Owner supplied proof denies status/RLS/write; fresh Owner proof works';
end;$$;
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=(select other_session from preview_fixture);
set role authenticated;
do $$declare f record; begin select * into f from preview_fixture;
  perform pg_temp.assert_true(not (public.staff_session_status()->>'sessionAllowed')::boolean,'expired Owner session status denied');
  perform pg_temp.assert_true((select count(*)=0 from public.workspace_orders),'expired Owner supplied session direct RLS denied');
  perform pg_temp.expect_denial(format('select public.workspace_order_create(%L,1,''OWNER-EXPIRED-DENIED'',%L,%L,''Synthetic'',''Inspection'',null,null)',f.workspace_id,f.branch_a,f.customer_a),'42501','expired Owner command denied');
  perform pg_temp.subject(f.owner_uid,null);
  perform pg_temp.assert_true((public.staff_session_status()->>'sessionAllowed')::boolean,'legacy NULL Owner proof retains active-profile behavior');
  raise notice 'PASS: expired supplied Owner proof denial; explicit legacy NULL compatibility boundary';
end;$$;
reset role;
-- Restore only the synthetic fresh session for the following overlap fixture.
insert into auth.sessions(id,user_id) select owner_session,owner_uid from preview_fixture;
update auth.sessions set not_after=null where id=(select other_session from preview_fixture);
