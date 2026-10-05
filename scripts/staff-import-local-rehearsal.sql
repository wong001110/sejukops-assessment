-- Disposable local PostgreSQL only: real SQL/leases with fictional Auth rows.
begin;
create temporary table import_fixture as select gen_random_uuid() as owner_uid,gen_random_uuid() as owner_profile,
  gen_random_uuid() as owner_session,coalesce((select id from public.workspaces where kind='OWNER' limit 1),gen_random_uuid()) as workspace_id,gen_random_uuid() as branch_id;
insert into auth.users(id,email) select owner_uid,'import-owner@local.example' from import_fixture;
insert into auth.sessions(id,user_id) select owner_session,owner_uid from import_fixture;
insert into public.profiles(id,auth_user_id,display_name,role,platform_role,active,demo_principal)
  select owner_profile,owner_uid,'Import Owner','ADMIN','SUPER_ADMIN',true,false from import_fixture;
insert into public.workspaces(id,kind,name) select workspace_id,'OWNER','Import fictional workspace' from import_fixture on conflict(id) do nothing;
insert into public.workspace_memberships(workspace_id,profile_id,role,active)
  select workspace_id,owner_profile,'ADMIN',true from import_fixture;
insert into public.workspace_branches(workspace_id,id,code,name)
  select workspace_id,branch_id,'IMPORT_BRANCH','Import fictional branch' from import_fixture;
create function pg_temp.import_assert(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if; end;
$$;
do $$declare f record; v_preview jsonb; v_id uuid; v_rows jsonb; v_claim jsonb; v_next jsonb; v_done jsonb;
  v_results jsonb; v_row jsonb; v_operation jsonb; v_account jsonb; v_key uuid;
begin
  select * into f from import_fixture;
  perform pg_temp.import_assert(not has_function_privilege('authenticated','public.staff_claim_import(uuid,uuid,uuid,uuid,boolean)','execute'),
    'ordinary Auth cannot invoke service import claims');
  begin
    perform public.staff_preview_import(f.owner_uid,gen_random_uuid(),f.workspace_id,'[]'::jsonb);
    raise exception 'FAIL: foreign Owner session accepted'; exception when insufficient_privilege then null; end;
  begin
    perform public.staff_preview_import(f.owner_uid,f.owner_session,gen_random_uuid(),'[]'::jsonb);
    raise exception 'FAIL: foreign workspace accepted'; exception when insufficient_privilege then null; end;
  begin
    perform public.staff_preview_import(f.owner_uid,f.owner_session,f.workspace_id,
      '[{"row":2,"input":{"name":"Bad","email":"bad@local.example","role":"ADMIN","branchCode":null,"password":"CANARY"}}]'::jsonb);
    raise exception 'FAIL: password persisted in import'; exception when invalid_parameter_value then null; end;
  v_preview := public.staff_preview_import(f.owner_uid,f.owner_session,f.workspace_id,
    '[{"row":2,"input":{"name":"Bad branch","email":"bad-branch@local.example","role":"TECHNICIAN","branchCode":"MISSING"}}]'::jsonb);
  perform pg_temp.import_assert((v_preview->>'invalidCount')::int=1 and not exists(select 1 from private.staff_imports where id=(v_preview->>'importId')::uuid),
    'invalid branch preview cannot be confirmed');
  v_preview := public.staff_preview_import(f.owner_uid,f.owner_session,f.workspace_id,
    '[{"row":2,"input":{"name":"Existing","email":"import-owner@local.example","role":"ADMIN","branchCode":null}}]'::jsonb);
  perform pg_temp.import_assert((v_preview->>'invalidCount')::int=1,'existing Auth is conflict before import');
  begin
    perform public.staff_preview_import(f.owner_uid,f.owner_session,f.workspace_id,
      '[{"row":2,"input":{"name":"Invalid email","email":"no-at-sign","role":"ADMIN","branchCode":null}}]'::jsonb);
    raise exception 'FAIL: malformed email persisted as valid preview'; exception when invalid_parameter_value then null; end;
  select jsonb_agg(jsonb_build_object('row',n+1,'input',jsonb_build_object('name','Import fixture '||n,
    'email','import-fixture-'||n||'@local.example','role','ADMIN','branchCode',null)) order by n)
    into v_rows from generate_series(1,11) n;
  v_preview := public.staff_preview_import(f.owner_uid,f.owner_session,f.workspace_id,v_rows);
  v_id := (v_preview->>'importId')::uuid;
  perform pg_temp.import_assert((v_preview->>'validCount')::int=11 and (select count(*)=11 from private.staff_import_rows where import_id=v_id),
    'valid preview persists canonical eleven rows');
  v_claim := public.staff_claim_import(f.owner_uid,f.owner_session,f.workspace_id,v_id,false);
  perform pg_temp.import_assert(jsonb_array_length(v_claim->'rows')=10,'batch capped at ten');
  begin
    perform public.staff_claim_import(f.owner_uid,f.owner_session,f.workspace_id,v_id,false);
    raise exception 'FAIL: overlapping import claimant accepted'; exception when lock_not_available then null; end;
  begin
    perform public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,null,'[]'::jsonb);
    raise exception 'FAIL: NULL claim accepted'; exception when unique_violation then null; end;
  begin
    perform public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_claim->>'claimToken')::uuid,
      '[{"row":12,"status":"FAILED","errorCode":"STAFF_UNAVAILABLE"}]'::jsonb);
    raise exception 'FAIL: unclaimed row completion accepted'; exception when invalid_parameter_value then null; end;
  begin
    perform public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_claim->>'claimToken')::uuid,
      '[{"row":2,"status":"CREATED","profileId":"11111111-1111-4111-8111-111111111111"}]'::jsonb);
    raise exception 'FAIL: fabricated created account accepted'; exception when unique_violation then null; end;
  begin
    perform public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_claim->>'claimToken')::uuid,
      '[{"row":2,"status":"FAILED","errorCode":"STAFF_UNAVAILABLE","credential":{"password":"CANARY"}}]'::jsonb);
    raise exception 'FAIL: secret persisted in batch result'; exception when invalid_parameter_value then null; end;
  v_row := v_claim->'rows'->0; v_key := (v_row->>'requestKey')::uuid;
  v_operation := public.staff_reserve_creation(f.owner_uid,f.owner_session,f.workspace_id,v_key,v_row->'input');
  insert into auth.users(id,email,raw_app_meta_data) values((v_operation->>'targetAuthUserId')::uuid,v_row->'input'->>'email',
    jsonb_build_object('sejukops_staff_operation',v_key));
  v_account := public.staff_finalize_creation(f.owner_uid,f.owner_session,f.workspace_id,v_key,(v_operation->>'claimToken')::uuid);
  select jsonb_agg(case when (r->>'row')::int=2 then jsonb_build_object('row',2,'status','CREATED','profileId',v_account->>'profileId')
    else jsonb_build_object('row',(r->>'row')::int,'status','FAILED','errorCode','STAFF_UNAVAILABLE') end)
    into v_results from jsonb_array_elements(v_claim->'rows') r;
  v_done := public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_claim->>'claimToken')::uuid,v_results);
  perform pg_temp.import_assert(not (v_done->>'complete')::boolean and jsonb_array_length(v_done->'results')=10,'partial batch reports rows without finishing remaining account');
  begin
    perform public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_claim->>'claimToken')::uuid,v_results);
    raise exception 'FAIL: consumed import claim reused'; exception when unique_violation then null; end;
  v_next := public.staff_claim_import(f.owner_uid,f.owner_session,f.workspace_id,v_id,false);
  perform pg_temp.import_assert(jsonb_array_length(v_next->'rows')=1,'resume excludes completed and failed rows');
  v_done := public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_next->>'claimToken')::uuid,
    '[{"row":12,"status":"FAILED","errorCode":"STAFF_CONFLICT"}]'::jsonb);
  perform pg_temp.import_assert((v_done->>'complete')::boolean and jsonb_array_length(v_done->'results')=11,'complete mixed batch retains all row results');
  v_next := public.staff_claim_import(f.owner_uid,f.owner_session,f.workspace_id,v_id,true);
  perform pg_temp.import_assert(jsonb_array_length(v_next->'rows')=10 and not exists(select 1 from jsonb_array_elements(v_next->'rows') r where (r->>'row')::int=2),
    'explicit retry affects failed rows only');
  perform pg_temp.import_assert((v_next->'rows'->0->>'requestKey')=(v_claim->'rows'->1->>'requestKey'),'retry keeps stable per-row operation ID');
  update private.staff_imports set claim_expires_at=clock_timestamp()-interval '1 second' where id=v_id;
  begin
    perform public.staff_finish_import_batch(f.owner_uid,f.owner_session,f.workspace_id,v_id,(v_next->>'claimToken')::uuid,'[]'::jsonb);
    raise exception 'FAIL: expired batch accepted'; exception when unique_violation then null; end;
  update private.staff_imports set expires_at=clock_timestamp()-interval '1 second' where id=v_id;
  begin
    perform public.staff_claim_import(f.owner_uid,f.owner_session,f.workspace_id,v_id,false);
    raise exception 'FAIL: expired draft accepted'; exception when invalid_parameter_value then null; end;
end;$$;
select 'PASS: bounded import SQL authorization, validation, lease, partial result, stable retry and secret-free ledger groups';
rollback;
