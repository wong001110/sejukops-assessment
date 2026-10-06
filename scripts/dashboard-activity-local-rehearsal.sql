-- Disposable localhost fixture only. Apply the current baseline and dashboard
-- migration first. Every synthetic business/Auth/audit row is rolled back.
begin;
set row_security=on;
create temporary table dashboard_fixture as select
  (select id from public.workspaces where kind='OWNER') workspace,
  (select id from public.workspaces where kind='DEMO') demo,
  gen_random_uuid() owner_uid,gen_random_uuid() owner_profile,gen_random_uuid() owner_session,
  gen_random_uuid() tech_a_uid,gen_random_uuid() tech_a_profile,gen_random_uuid() tech_a_session,gen_random_uuid() tech_a,
  gen_random_uuid() tech_b_uid,gen_random_uuid() tech_b_profile,gen_random_uuid() tech_b_session,gen_random_uuid() tech_b,
  gen_random_uuid() guest_uid,gen_random_uuid() guest_profile,gen_random_uuid() visit,
  gen_random_uuid() demo_tech_uid,gen_random_uuid() demo_tech_profile,gen_random_uuid() demo_tech,
  gen_random_uuid() branch,gen_random_uuid() demo_branch,gen_random_uuid() customer,gen_random_uuid() demo_customer,
  gen_random_uuid() order_a,gen_random_uuid() order_b,gen_random_uuid() demo_order,
  (select generation from public.workspaces where kind='OWNER') generation,
  (select generation from public.workspaces where kind='DEMO') demo_generation,
  clock_timestamp() instant;
grant select on dashboard_fixture to authenticated;
create or replace function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; end;$$;
create or replace function pg_temp.subject(uid uuid,session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',session,'is_anonymous',false)::text,true);
$$;
create or replace function pg_temp.denied(statement text,label text,expected_state text default '42501') returns void language plpgsql as $$
declare observed text;
begin begin execute statement; raise exception 'FAIL: accepted %',label;
  exception when others then get stacked diagnostics observed=returned_sqlstate;
    if observed<>expected_state then raise exception 'FAIL: % expected %, got %',label,expected_state,observed; end if;
  end;
end;$$;
insert into auth.users(id,email) select owner_uid,'dashboard-owner@local.example' from dashboard_fixture
  union all select tech_a_uid,'dashboard-a@local.example' from dashboard_fixture
  union all select tech_b_uid,'dashboard-b@local.example' from dashboard_fixture
  union all select guest_uid,'dashboard-guest@local.example' from dashboard_fixture
  union all select demo_tech_uid,'dashboard-demo-tech@local.example' from dashboard_fixture;
insert into auth.sessions(id,user_id) select owner_session,owner_uid from dashboard_fixture
  union all select tech_a_session,tech_a_uid from dashboard_fixture
  union all select tech_b_session,tech_b_uid from dashboard_fixture;
insert into public.profiles(id,auth_user_id,display_name,role,platform_role,demo_principal)
  select owner_profile,owner_uid,'Dashboard Owner','ADMIN'::public.app_role,'SUPER_ADMIN'::public.platform_role,false from dashboard_fixture
  union all select tech_a_profile,tech_a_uid,'Dashboard Technician A','TECHNICIAN','USER',false from dashboard_fixture
  union all select tech_b_profile,tech_b_uid,'Dashboard Technician B','TECHNICIAN','USER',false from dashboard_fixture
  union all select guest_profile,guest_uid,'Dashboard Guest','ADMIN','USER',true from dashboard_fixture
  union all select demo_tech_profile,demo_tech_uid,'Dashboard Demo Technician','TECHNICIAN','USER',true from dashboard_fixture;
insert into public.workspace_memberships(workspace_id,profile_id,role)
  select workspace,owner_profile,'ADMIN'::public.app_role from dashboard_fixture
  union all select workspace,tech_a_profile,'TECHNICIAN' from dashboard_fixture
  union all select workspace,tech_b_profile,'TECHNICIAN' from dashboard_fixture
  union all select demo,guest_profile,'ADMIN' from dashboard_fixture
  union all select demo,demo_tech_profile,'TECHNICIAN' from dashboard_fixture;
insert into private.staff_accounts(profile_id,auth_user_id,workspace_id,email,password_change_required)
  select tech_a_profile,tech_a_uid,workspace,'dashboard-a@local.example',false from dashboard_fixture
  union all select tech_b_profile,tech_b_uid,workspace,'dashboard-b@local.example',false from dashboard_fixture;
insert into public.workspace_branches(workspace_id,id,code,name)
  select workspace,branch,'DASH-OWNER','Dashboard Owner branch' from dashboard_fixture
  union all select demo,demo_branch,'DASH-DEMO','Dashboard Demo branch' from dashboard_fixture;
insert into public.workspace_technicians(workspace_id,id,profile_id,branch_id)
  select workspace,tech_a,tech_a_profile,branch from dashboard_fixture
  union all select workspace,tech_b,tech_b_profile,branch from dashboard_fixture
  union all select demo,demo_tech,demo_tech_profile,demo_branch from dashboard_fixture;
insert into public.workspace_customers(workspace_id,id,name,address)
  select workspace,customer,'Dashboard Customer','Synthetic service area' from dashboard_fixture
  union all select demo,demo_customer,'Dashboard Demo Customer','Synthetic service area' from dashboard_fixture;
insert into public.workspace_orders(workspace_id,id,order_no,branch_id,customer_id,assigned_technician_id,status,problem_description,service_type,created_by_profile_id)
  select workspace,order_a,'DASH-A',branch,customer,tech_a,'COMPLETED'::public.service_order_status,'Synthetic request','Inspection',owner_profile from dashboard_fixture
  union all select workspace,order_b,'DASH-B',branch,customer,tech_b,'COMPLETED','Synthetic request','Repair',owner_profile from dashboard_fixture
  union all select demo,demo_order,'DASH-DEMO',demo_branch,demo_customer,demo_tech,'COMPLETED','Synthetic request','Inspection',guest_profile from dashboard_fixture;
insert into public.guest_visits(id,token_hash,workspace_id,persona,demo_generation,expires_at)
  select visit,repeat('c',64),demo,'ADMIN',demo_generation,clock_timestamp()+interval '1 hour' from dashboard_fixture;

-- Current event time is halfway from MYT midnight to now. Previous comparable
-- event uses the same elapsed position yesterday; updated_at remains unrelated.
insert into private.workspace_order_activity_audit(workspace_id,workspace_generation,order_id,actor_profile_id,source,from_status,to_status,occurred_at)
select f.workspace,f.generation,o.order_id,f.tech_a_profile,'ACCOUNT','IN_PROGRESS','COMPLETED',
  (date_trunc('day',f.instant at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur')+
  (f.instant-(date_trunc('day',f.instant at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'))/2
  from dashboard_fixture f cross join lateral (values(f.order_a),(f.order_b)) o(order_id);
insert into private.workspace_order_activity_audit(workspace_id,workspace_generation,order_id,actor_profile_id,source,from_status,to_status,occurred_at)
select f.workspace,f.generation,f.order_a,f.tech_a_profile,'ACCOUNT','IN_PROGRESS','COMPLETED',
  (date_trunc('day',f.instant at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur')-interval '1 day'+
  (f.instant-(date_trunc('day',f.instant at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'))/2
  from dashboard_fixture f;
insert into private.workspace_order_activity_audit(workspace_id,workspace_generation,order_id,actor_profile_id,source,from_status,to_status,occurred_at)
select workspace,generation+1,order_a,tech_a_profile,'ACCOUNT','IN_PROGRESS'::public.service_order_status,'COMPLETED'::public.service_order_status,instant from dashboard_fixture
  union all select workspace,generation,gen_random_uuid(),tech_a_profile,'ACCOUNT','IN_PROGRESS','COMPLETED',instant from dashboard_fixture
  union all select demo,demo_generation,demo_order,guest_profile,'ACCOUNT','IN_PROGRESS','COMPLETED',instant from dashboard_fixture;
insert into private.workspace_order_schedule_audit(workspace_id,workspace_generation,order_id,actor_profile_id,source,to_scheduled_at,occurred_at)
  select f.workspace,f.generation,o.order_id,f.owner_profile,'ACCOUNT',f.instant+interval '1 day',f.instant
  from dashboard_fixture f cross join lateral(values(f.order_a),(f.order_b)) o(order_id);

set role authenticated;
do $$declare f record;r jsonb;begin select * into f from dashboard_fixture;
  perform pg_temp.subject(f.owner_uid,f.owner_session);
  r:=public.workspace_dashboard_activity(f.workspace,f.generation,'today');
  perform pg_temp.assert_true((r->>'completed')::integer=2,'Admin exact completions, ignores old generation/orphans/Demo');
  perform pg_temp.assert_true((r->>'previousCompleted')::integer=1,'equal elapsed previous period');
  perform pg_temp.assert_true((r->>'rescheduled')::integer=2,'actual schedule audit counts');
  perform pg_temp.assert_true((select sum((value->>'jobs')::integer)=2 from jsonb_array_elements(r->'trend')),'completion trend sums actual events');
  perform pg_temp.assert_true(jsonb_array_length(r->'technicians')=2,'scoped technician names');
  perform pg_temp.assert_true(not has_table_privilege(current_user,'private.workspace_order_activity_audit','SELECT'),'raw completion audit hidden');
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'')',f.demo,f.demo_generation),'workspace substitution');
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'')',f.workspace,f.generation+1),'stale generation','P0001');
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''all_time'')',f.workspace,f.generation),'invalid period');
  r:=public.owner_preview_set(f.workspace,'MANAGER',null);
  r:=public.workspace_dashboard_activity(f.workspace,f.generation,'today');
  perform pg_temp.assert_true((r->>'completed')::integer=2,'Manager preview summary');
  perform public.owner_preview_set(f.workspace,'TECHNICIAN',f.tech_a_profile);
  r:=public.workspace_dashboard_activity(f.workspace,f.generation,'today');
  perform pg_temp.assert_true((r->>'completed')::integer=1 and (r->>'rescheduled')::integer=1,'Tech A preview exact job scope');
  perform pg_temp.assert_true(jsonb_array_length(r->'technicians')=1 and r->'technicians'->0->>'name'='Dashboard Technician A','Tech preview name isolation');
  perform public.owner_preview_exit();
  perform pg_temp.subject(f.tech_b_uid,f.tech_b_session);
  r:=public.workspace_dashboard_activity(f.workspace,f.generation,'today');
  perform pg_temp.assert_true((r->>'completed')::integer=1 and r->'technicians'->0->>'name'='Dashboard Technician B','formal Technician job isolation');
  perform pg_temp.subject(f.guest_uid,null);
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'')',f.demo,f.demo_generation),'Guest proof required');
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'',%L,%L)',f.demo,f.demo_generation,f.visit,repeat('d',64)),'wrong Guest token');
  r:=public.workspace_dashboard_activity(f.demo,f.demo_generation,'today',f.visit,repeat('c',64));
  perform pg_temp.assert_true((r->>'completed')::integer=1,'Guest sees only Demo activity');
  raise notice 'PASS dashboard: Admin, Manager, Tech, preview, Guest, generation, orphan, trend and private audit boundaries';
end;$$;
reset role;
update private.staff_accounts set password_change_required=true where profile_id=(select tech_a_profile from dashboard_fixture);
update public.guest_visits set revoked_at=clock_timestamp() where id=(select visit from dashboard_fixture);
set role authenticated;
do $$declare f record;begin select * into f from dashboard_fixture;
  perform pg_temp.subject(f.tech_a_uid,f.tech_a_session);
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'')',f.workspace,f.generation),'onboarding not ready');
  perform pg_temp.subject(f.guest_uid,null);
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'',%L,%L)',f.demo,f.demo_generation,f.visit,repeat('c',64)),'revoked Guest visit');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f.owner_uid,'session_id',f.owner_session,'is_anonymous',true)::text,true);
  perform pg_temp.denied(format('select public.workspace_dashboard_activity(%L,%s,''today'')',f.workspace,f.generation),'anonymous identity forbidden');
end;$$;
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.workspace_dashboard_activity(uuid,bigint,text,uuid,text)','EXECUTE'),'anon execute denied');
select pg_temp.assert_true(not has_function_privilege('service_role','public.workspace_dashboard_activity(uuid,bigint,text,uuid,text)','EXECUTE'),'service role cannot substitute identity');
rollback;
