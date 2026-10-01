-- Disposable localhost PostgreSQL only. Synthetic users/password sentinels;
-- reuse the rehearsal's OWNER workspace instead of creating a second one.
set row_security = on;
create temporary table reset_fixture as
select gen_random_uuid() owner_uid,gen_random_uuid() staff_uid,
  gen_random_uuid() owner_profile,gen_random_uuid() staff_profile,
  gen_random_uuid() owner_session,gen_random_uuid() old_staff_session,
  gen_random_uuid() pending_session,gen_random_uuid() proof_session,gen_random_uuid() ready_session,
  gen_random_uuid() reset_key,gen_random_uuid() reconcile_key,
  (select id from public.workspaces where kind='OWNER' and active order by id limit 1) workspace_id;
grant select on reset_fixture to authenticated,service_role;

create function pg_temp.reset_assert(p_value boolean,p_label text) returns void language plpgsql as $$
begin if p_value is distinct from true then raise exception 'FAIL: %',p_label; end if; end;
$$;
create function pg_temp.reset_expect_sqlstate(p_sql text,p_expected text,p_label text) returns void language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  raise exception 'FAIL: % unexpectedly succeeded',p_label;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  if v_state='P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  if v_state<>p_expected then raise exception 'FAIL: % returned SQLSTATE %, expected %',p_label,v_state,p_expected; end if;
end;
$$;
create function pg_temp.reset_actor_ready(p_user uuid,p_workspace uuid,p_session uuid,p_allow_pending boolean default false)
returns boolean language sql security definer set search_path='' as $$
  select private.staff_actor_ready(p_user,p_workspace,p_session,false,p_allow_pending)
$$;
create function pg_temp.reset_status(p_user uuid,p_session uuid) returns jsonb language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'session_id',p_session,'is_anonymous',false)::text,false);
  return public.staff_session_status();
end;
$$;
create function pg_temp.reset_set_auth(p_user uuid,p_password text,p_marker text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  update auth.users set encrypted_password=p_password,
    raw_app_meta_data=case when p_marker is null then raw_app_meta_data
      else jsonb_set(raw_app_meta_data,'{sejukops_staff_password_reset}',to_jsonb(p_marker)) end
    where id=p_user;
end;
$$;
create function pg_temp.reset_add_session(p_user uuid,p_session uuid,p_created_at timestamptz default clock_timestamp())
returns void language sql security definer set search_path='' as $$
  insert into auth.sessions(id,user_id,created_at) values(p_session,p_user,p_created_at)
$$;
create function pg_temp.reset_expire_claim(p_request_key uuid) returns void language sql security definer set search_path='' as $$
  update private.staff_password_resets set created_at=clock_timestamp()-interval '1 minute',
    claim_expires_at=clock_timestamp()-interval '1 second' where id=p_request_key
$$;

do $$declare f record; begin
  select * into f from reset_fixture;
  perform pg_temp.reset_assert(f.workspace_id is not null,'an existing active OWNER workspace is required');
end;$$;

insert into auth.users(id,email,is_anonymous,email_confirmed_at,raw_app_meta_data,encrypted_password)
select owner_uid,'reset-owner@local.example',false,clock_timestamp(),'{}'::jsonb,'synthetic-owner-password' from reset_fixture
union all
select staff_uid,'reset-staff@local.example',false,clock_timestamp(),jsonb_build_object('sejukops_staff_operation','synthetic-create-op'),'synthetic-start-password' from reset_fixture;
insert into auth.sessions(id,user_id,created_at)
select owner_session,owner_uid,clock_timestamp() from reset_fixture
union all select old_staff_session,staff_uid,clock_timestamp()-interval '1 day' from reset_fixture;
insert into public.profiles(id,auth_user_id,display_name,role,platform_role,active,demo_principal)
select owner_profile,owner_uid,'Synthetic reset Owner','ADMIN'::public.app_role,'SUPER_ADMIN'::public.platform_role,true,false from reset_fixture
union all
select staff_profile,staff_uid,'Synthetic reset staff','ADMIN','USER',true,false from reset_fixture;
insert into public.workspace_memberships(workspace_id,profile_id,role,active)
select workspace_id,owner_profile,'ADMIN'::public.app_role,true from reset_fixture
union all select workspace_id,staff_profile,'ADMIN',true from reset_fixture;
insert into private.staff_accounts(profile_id,auth_user_id,workspace_id,email)
select staff_profile,staff_uid,workspace_id,'reset-staff@local.example' from reset_fixture;

set role authenticated;
do $$declare f record; begin
  select * into f from reset_fixture;
  perform pg_temp.reset_assert(not has_function_privilege(current_user,
    'public.staff_reserve_password_reset(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'),
    'authenticated cannot execute password-reset reserve RPC');
  perform pg_temp.reset_assert(not has_function_privilege(current_user,
    'public.staff_finalize_password_reset(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'),
    'authenticated cannot execute password-reset finalize RPC');
  begin perform public.staff_reserve_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,gen_random_uuid(),f.reset_key);
    raise exception 'FAIL: authenticated invoked password-reset reserve';
  exception when insufficient_privilege then null; end;
  begin perform public.staff_finalize_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key,gen_random_uuid());
    raise exception 'FAIL: authenticated invoked password-reset finalize';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: authenticated has no EXECUTE grant on either Owner password-reset RPC';
end;$$;
reset role;

set role service_role;
do $$declare f record; v_old private.staff_accounts; v_res jsonb; v_retry jsonb; v_account jsonb;
  v_revision uuid; v_new_revision uuid; v_expected uuid; v_claim jsonb; v_status jsonb;
  v_pending_session uuid; v_late_session uuid;
begin
  select * into f from reset_fixture;
  select * into v_old from private.staff_accounts where profile_id=f.staff_profile;
  perform pg_temp.reset_assert(not has_table_privilege(current_user,'private.staff_password_resets','SELECT'),
    'reset ledger remains private from service role');
  v_expected := v_old.auth_revision;
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_reserve_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,gen_random_uuid(),f.reset_key),'40001','stale account revision is rejected');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_reserve_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.staff_uid,f.old_staff_session,f.workspace_id,f.staff_profile,v_expected,f.reset_key),'42501','staff cannot impersonate Owner reset authority');

  v_res := public.staff_reserve_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_expected,f.reset_key);
  perform pg_temp.reset_assert(v_res->>'state'='RESERVED','first reset reserves an operation');
  v_revision := (v_res->>'resetRevision')::uuid;
  select * into v_old from private.staff_accounts where profile_id=f.staff_profile;
  perform pg_temp.reset_assert(v_old.password_change_required and v_old.auth_revision=v_revision
    and v_old.sessions_valid_after>clock_timestamp()-interval '1 minute','reservation blocks password and rotates the session cutoff/revision');
  perform pg_temp.reset_assert(not pg_temp.reset_actor_ready(f.staff_uid,f.workspace_id,f.old_staff_session),'reservation immediately denies the old session');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_reserve_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_expected,f.reset_key),'55P03','active same-operation lease blocks a second Auth writer');
  -- A request key is bound to the original expected revision even when the
  -- account row already carries its new reset revision.
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_reserve_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_revision,f.reset_key),'23505','request key cannot change its original CAS input');

  perform pg_temp.reset_expire_claim(f.reset_key);
  v_res := public.staff_reserve_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_expected,f.reset_key);
  perform pg_temp.reset_assert(v_res->>'state'='RESERVED','same operation retry is reserved under original expected revision');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_finalize_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,null)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key),'40001','missing reset claim is denied');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_finalize_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key,gen_random_uuid()),'40001','wrong reset claim is denied');
  perform pg_temp.reset_expire_claim(f.reset_key);
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_finalize_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key,v_res->>'claimToken'),'40001','expired reset claim is denied');
  v_res := public.staff_reserve_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_expected,f.reset_key);
  perform pg_temp.reset_assert(v_res->>'state'='RESERVED','expired claim is renewed under the original request key');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_finalize_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key,v_res->>'claimToken'),'42501','marker without changed password fingerprint is not proof');
  perform pg_temp.reset_set_auth(f.staff_uid,'synthetic-wrong-marker-password','foreign-reset-op');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_finalize_password_reset(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key,v_res->>'claimToken'),'42501','changed fingerprint with wrong operation marker is not proof');
  perform pg_temp.reset_set_auth(f.staff_uid,'synthetic-first-reset-password',f.reset_key::text);
  v_account := public.staff_finalize_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,f.reset_key,(v_res->>'claimToken')::uuid);
  perform pg_temp.reset_assert((v_account->>'passwordChangeRequired')::boolean and (v_account->>'authRevision')::uuid=v_revision,
    'finalization accepts only the reserved reset revision and keeps onboarding required');
  perform pg_temp.reset_assert(not pg_temp.reset_actor_ready(f.staff_uid,f.workspace_id,f.old_staff_session),'old session remains denied after Auth reset');
  perform pg_temp.reset_add_session(f.staff_uid,f.pending_session);
  v_status := pg_temp.reset_status(f.staff_uid,f.pending_session);
  perform pg_temp.reset_assert((v_status->>'passwordChangeRequired')::boolean and (v_status->>'sessionAllowed')::boolean,
    'new password can reach onboarding but not business readiness');
  perform pg_temp.reset_assert(not pg_temp.reset_actor_ready(f.staff_uid,f.workspace_id,f.pending_session),'pending reset session is denied business access');

  -- Complete onboarding through the existing pre-proof claim to verify that the
  -- reset sentinel was refreshed and ordinary staff access can be restored.
  perform pg_temp.reset_set_auth(f.staff_uid,'synthetic-onboarded-password');
  v_claim := public.staff_issue_password_claim(f.staff_uid,v_revision,f.pending_session);
  perform pg_temp.reset_assert((v_claim-'claimId'-'expiresAt')='{}'::jsonb,'password claim exposes no secret or fingerprint');
  v_new_revision := v_revision;
  perform pg_temp.reset_add_session(f.staff_uid,f.proof_session);
  perform public.staff_complete_password_change(f.staff_uid,v_new_revision,f.proof_session,(v_claim->>'claimId')::uuid);
  perform pg_temp.reset_add_session(f.staff_uid,f.ready_session);
  perform pg_temp.reset_assert(pg_temp.reset_actor_ready(f.staff_uid,f.workspace_id,f.ready_session),'current pre-proof fingerprint restores readiness in a post-cutoff session');

  -- Second reset exercises crash reconciliation: Auth is mutated, the original
  -- response/finalization is lost, and retry proves marker + changed sentinel.
  select auth_revision into v_expected from private.staff_accounts where profile_id=f.staff_profile;
  v_res := public.staff_reserve_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_expected,f.reconcile_key);
  v_new_revision := (v_res->>'resetRevision')::uuid;
  perform pg_temp.reset_set_auth(f.staff_uid,'synthetic-reconciled-reset-password',f.reconcile_key::text);
  v_retry := public.staff_reserve_password_reset(f.owner_uid,f.owner_session,f.workspace_id,f.staff_profile,v_expected,f.reconcile_key);
  perform pg_temp.reset_assert(v_retry->>'state'='RESET' and not (v_retry ? 'credential') and
    (v_retry->'account'->>'passwordChangeRequired')::boolean and (v_retry->'account'->>'authRevision')::uuid=v_new_revision,
    'uncertain Auth update reconciles without persisting or returning a password');
  perform pg_temp.reset_assert((select count(*)=1 from public.audit_logs where idempotency_key=f.reconcile_key::text||':reset'),
    'reconciliation writes one completed reset audit');

  -- A later Auth write after password proof makes both completion and business
  -- readiness fail closed; the pending session can still recover by onboarding.
  v_pending_session := gen_random_uuid();
  perform pg_temp.reset_add_session(f.staff_uid,v_pending_session);
  perform pg_temp.reset_set_auth(f.staff_uid,'synthetic-post-claim-password');
  v_claim := public.staff_issue_password_claim(f.staff_uid,v_new_revision,v_pending_session);
  v_late_session := gen_random_uuid();
  perform pg_temp.reset_add_session(f.staff_uid,v_late_session);
  perform pg_temp.reset_set_auth(f.staff_uid,'synthetic-late-auth-write');
  perform pg_temp.reset_expect_sqlstate(format('select public.staff_complete_password_change(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    f.staff_uid,v_new_revision,v_late_session,v_claim->>'claimId'),'42501','late Auth mutation invalidates password completion claim');
  perform pg_temp.reset_assert(not pg_temp.reset_actor_ready(f.staff_uid,f.workspace_id,v_late_session),'late Auth write denies business readiness');
  v_status := pg_temp.reset_status(f.staff_uid,v_late_session);
  perform pg_temp.reset_assert((v_status->>'passwordChangeRequired')::boolean and (v_status->>'sessionAllowed')::boolean,
    'late Auth write keeps the user in recoverable onboarding');
  raise notice 'PASS: reset revision/CAS, session cutoff, opaque claims, marker+fingerprint finalization/reconciliation, retry idempotency and late Auth write fail-closed';
end;$$;
reset role;

-- Remove only fixtures and audit rows created by this script.
delete from public.audit_logs where idempotency_key in
  ((select reset_key::text from reset_fixture)||':reserved',
   (select reset_key::text from reset_fixture)||':reset',
   (select reconcile_key::text from reset_fixture)||':reserved',
   (select reconcile_key::text from reset_fixture)||':reset')
  or actor_profile_id in ((select owner_profile from reset_fixture),(select staff_profile from reset_fixture));
delete from public.workspace_memberships where profile_id in
  ((select owner_profile from reset_fixture),(select staff_profile from reset_fixture));
delete from auth.sessions where user_id in ((select owner_uid from reset_fixture),(select staff_uid from reset_fixture));
delete from auth.users where id in ((select owner_uid from reset_fixture),(select staff_uid from reset_fixture));
delete from public.profiles where id in ((select owner_profile from reset_fixture),(select staff_profile from reset_fixture));
do $$begin
  perform pg_temp.reset_assert(not exists(select 1 from auth.users where email in ('reset-owner@local.example','reset-staff@local.example')),
    'only synthetic Auth fixtures removed');
  perform pg_temp.reset_assert(not exists(select 1 from private.staff_password_resets where id in
    ((select reset_key from reset_fixture),(select reconcile_key from reset_fixture))),'reset operation fixtures removed');
  raise notice 'PASS: exact synthetic reset fixture cleanup; reused OWNER workspace preserved';
end;$$;
