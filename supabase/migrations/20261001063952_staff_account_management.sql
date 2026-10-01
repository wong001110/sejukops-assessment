-- Server-only account lifecycle. Caller IDs/session proof come from verified Auth,
-- never from an uploaded workbook or browser-selected role.
create function private.staff_assert_owner(p_auth_user_id uuid, p_session_id uuid, p_workspace_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid;
begin
  select p.id into v_profile_id from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    where p.auth_user_id = p_auth_user_id and p.active and not p.demo_principal
      and p.platform_role = 'SUPER_ADMIN' and u.is_anonymous is false for share of p;
  if v_profile_id is null or p_session_id is null or not exists (
    select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_auth_user_id
      and (s.not_after is null or s.not_after > clock_timestamp())
  ) then raise exception 'STAFF_OWNER_REQUIRED' using errcode = '42501'; end if;
  perform 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id
    where m.profile_id = v_profile_id and m.workspace_id = p_workspace_id and m.active
      and w.active and w.kind = 'OWNER' for share of m,w;
  if not found then raise exception 'STAFF_WORKSPACE_FORBIDDEN' using errcode = '42501'; end if;
  return v_profile_id;
end;
$$;

create function private.staff_account_summary(p_profile_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('profileId',p.id,'name',p.display_name,'email',s.email,
    'role',m.role,'branchCode',case when m.role = 'TECHNICIAN' then b.code else null end,
    'active',p.active and m.active,'passwordChangeRequired',s.password_change_required,
    'authRevision',s.auth_revision)
  from private.staff_accounts s join public.profiles p on p.id = s.profile_id
    join public.workspace_memberships m on m.profile_id = s.profile_id and m.workspace_id = s.workspace_id
    left join public.workspace_technicians t on t.profile_id = s.profile_id and t.workspace_id = s.workspace_id
    left join public.workspace_branches b on b.id = t.branch_id and b.workspace_id = t.workspace_id
  where s.profile_id = p_profile_id;
$$;

create function public.staff_list(p_owner_auth_user_id uuid,p_owner_session_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(private.staff_account_summary(s.profile_id) order by s.email)
    from private.staff_accounts s where s.workspace_id = p_workspace_id),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('code',b.code,'name',b.name) order by b.code)
      from public.workspace_branches b where b.workspace_id = p_workspace_id and b.active),'[]'::jsonb));
end;
$$;

create function public.staff_reserve_creation(p_owner_auth_user_id uuid,p_owner_session_id uuid,
  p_workspace_id uuid,p_request_key uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_operation private.staff_provisioning; v_email text := p_input->>'email';
  v_hash text := encode(extensions.digest(p_input::text,'sha256'),'hex');
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  if p_request_key is null or not private.staff_input_valid(p_input,v_email)
    or v_email <> lower(btrim(v_email)) then
    raise exception 'STAFF_INVALID_INPUT' using errcode = '22023'; end if;
  if p_input->>'role' = 'TECHNICIAN' then
    perform 1 from public.workspace_branches b where b.workspace_id = p_workspace_id
      and b.code = p_input->>'branchCode' and b.active for share;
    if not found then raise exception 'STAFF_BRANCH_INVALID' using errcode = '22023'; end if;
  end if;
  -- A normalized email reservation serializes different keys without a workspace leak.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-email:' || v_email,0));
  select * into v_operation from private.staff_provisioning where id = p_request_key for update;
  if v_operation.id is not null then
    if v_operation.owner_profile_id <> v_owner or v_operation.workspace_id <> p_workspace_id
      or v_operation.input_hash <> v_hash or v_operation.input <> p_input then
      raise exception 'STAFF_REQUEST_CONFLICT' using errcode = '23505'; end if;
    if v_operation.state = 'CREATED' then
      return jsonb_build_object('state','CREATED','account',private.staff_account_summary(v_operation.target_profile_id));
    end if;
    if v_operation.state = 'RESERVED' and v_operation.claim_expires_at > clock_timestamp() then
      raise exception 'STAFF_BUSY' using errcode = '55P03'; end if;
    update private.staff_provisioning set state = 'RESERVED',claim_token = gen_random_uuid(),
      claim_expires_at = clock_timestamp()+interval '2 minutes',last_error_code = null,updated_at = clock_timestamp()
      where id = p_request_key returning * into v_operation;
  else
    if exists (select 1 from private.staff_provisioning where email = v_email)
      or exists (select 1 from auth.users where lower(email) = v_email) then
      raise exception 'STAFF_EMAIL_CONFLICT' using errcode = '23505'; end if;
    insert into private.staff_provisioning(id,owner_profile_id,workspace_id,input_hash,email,
      target_auth_user_id,target_profile_id,input,claim_expires_at)
      values(p_request_key,v_owner,p_workspace_id,v_hash,v_email,gen_random_uuid(),gen_random_uuid(),
        p_input,clock_timestamp()+interval '2 minutes') returning * into v_operation;
  end if;
  return jsonb_build_object('state','RESERVED','operationId',v_operation.id,'claimToken',v_operation.claim_token,
    'targetAuthUserId',v_operation.target_auth_user_id,'targetProfileId',v_operation.target_profile_id);
end;
$$;

create function public.staff_finalize_creation(p_owner_auth_user_id uuid,p_owner_session_id uuid,
  p_workspace_id uuid,p_request_key uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_operation private.staff_provisioning; v_branch uuid; v_role public.app_role;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_operation from private.staff_provisioning where id = p_request_key for update;
  if v_operation.id is null or p_claim_token is null or v_operation.owner_profile_id <> v_owner or v_operation.workspace_id <> p_workspace_id
    or v_operation.claim_token <> p_claim_token then
    raise exception 'STAFF_REQUEST_CONFLICT' using errcode = '42501'; end if;
  if v_operation.state = 'CREATED' then return private.staff_account_summary(v_operation.target_profile_id); end if;
  if v_operation.claim_expires_at <= clock_timestamp() then
    raise exception 'STAFF_REQUEST_CONFLICT' using errcode = '40001'; end if;
  if v_operation.state <> 'RESERVED' or not exists (
    select 1 from auth.users u where u.id = v_operation.target_auth_user_id and lower(u.email) = v_operation.email
      and u.is_anonymous is false and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'sejukops_staff_operation' = v_operation.id::text
  ) then raise exception 'STAFF_AUTH_NOT_READY' using errcode = '42501'; end if;
  v_role := (v_operation.input->>'role')::public.app_role;
  if v_role = 'TECHNICIAN' then
    select id into v_branch from public.workspace_branches where workspace_id = p_workspace_id
      and code = v_operation.input->>'branchCode' and active for share;
    if v_branch is null then raise exception 'STAFF_BRANCH_INVALID' using errcode = '22023'; end if;
  end if;
  insert into public.profiles(id,auth_user_id,display_name,role,platform_role,active,demo_principal)
    values(v_operation.target_profile_id,v_operation.target_auth_user_id,v_operation.input->>'name',v_role,'USER',true,false);
  insert into private.staff_accounts(profile_id,auth_user_id,workspace_id,email)
    values(v_operation.target_profile_id,v_operation.target_auth_user_id,p_workspace_id,v_operation.email);
  insert into public.workspace_memberships(workspace_id,profile_id,role,active)
    values(p_workspace_id,v_operation.target_profile_id,v_role,true);
  if v_role = 'TECHNICIAN' then
    insert into public.workspace_technicians(workspace_id,profile_id,branch_id,active)
      values(p_workspace_id,v_operation.target_profile_id,v_branch,true);
  end if;
  update private.staff_provisioning set state = 'CREATED',last_error_code = null,updated_at = clock_timestamp()
    where id = p_request_key;
  insert into public.audit_logs(id,actor_profile_id,event_type,idempotency_key,metadata_json)
    values(gen_random_uuid(),v_owner,'STAFF_ACCOUNT_CREATED',p_request_key::text,
      jsonb_build_object('workspaceId',p_workspace_id,'profileId',v_operation.target_profile_id,'role',v_role));
  return private.staff_account_summary(v_operation.target_profile_id);
end;
$$;

create function public.staff_fail_creation(p_owner_auth_user_id uuid,p_owner_session_id uuid,
  p_workspace_id uuid,p_request_key uuid,p_claim_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  update private.staff_provisioning set state = 'FAILED',last_error_code = 'PROVISIONING_FAILED',updated_at = clock_timestamp()
    where id = p_request_key and owner_profile_id = v_owner and workspace_id = p_workspace_id
      and claim_token = p_claim_token and state = 'RESERVED';
end;
$$;

create function public.staff_update_account(p_owner_auth_user_id uuid,p_owner_session_id uuid,p_workspace_id uuid,
  p_profile_id uuid,p_expected_revision uuid,p_role public.app_role,p_branch_code text,p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_staff private.staff_accounts; v_branch uuid;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  perform 1 from public.profiles where id = p_profile_id for update;
  select * into v_staff from private.staff_accounts where profile_id = p_profile_id and workspace_id = p_workspace_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision <> p_expected_revision then
    raise exception 'STAFF_STALE_ACCOUNT' using errcode = '40001'; end if;
  if p_role is null or p_active is null or (p_role <> 'TECHNICIAN' and p_branch_code is not null) then
    raise exception 'STAFF_INVALID_INPUT' using errcode = '22023'; end if;
  if p_role = 'TECHNICIAN' then
    select id into v_branch from public.workspace_branches where workspace_id = p_workspace_id and active and code = p_branch_code for share;
    if v_branch is null then raise exception 'STAFF_BRANCH_INVALID' using errcode = '22023'; end if;
    if exists (select 1 from public.workspace_technicians t join public.workspace_orders o
      on o.workspace_id = t.workspace_id and o.assigned_technician_id = t.id
      where t.workspace_id = p_workspace_id and t.profile_id = p_profile_id and t.branch_id <> v_branch) then
      raise exception 'STAFF_BRANCH_IN_USE' using errcode = '23514'; end if;
  end if;
  update public.workspace_memberships set role = p_role,active = p_active,updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and profile_id = p_profile_id;
  if not found then raise exception 'STAFF_MEMBERSHIP_MISSING' using errcode = '23514'; end if;
  update public.profiles set active = p_active,role = p_role,updated_at = clock_timestamp() where id = p_profile_id;
  if p_role = 'TECHNICIAN' then
    insert into public.workspace_technicians(workspace_id,profile_id,branch_id,active)
      values(p_workspace_id,p_profile_id,v_branch,p_active)
      on conflict(workspace_id,profile_id) do update set branch_id = excluded.branch_id,active = excluded.active,updated_at = clock_timestamp();
  else
    update public.workspace_technicians set active = false,updated_at = clock_timestamp()
      where workspace_id = p_workspace_id and profile_id = p_profile_id;
  end if;
  update private.staff_accounts set auth_revision = gen_random_uuid(),sessions_valid_after = clock_timestamp(),updated_at = clock_timestamp()
    where profile_id = p_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    values(gen_random_uuid(),v_owner,'STAFF_ACCOUNT_UPDATED',jsonb_build_object('workspaceId',p_workspace_id,
      'profileId',p_profile_id,'role',p_role,'active',p_active));
  return private.staff_account_summary(p_profile_id);
end;
$$;

create function public.staff_complete_password_change(p_auth_user_id uuid,p_expected_revision uuid,p_actor_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; v_staff private.staff_accounts;
begin
  select id into v_profile_id from public.profiles where auth_user_id = p_auth_user_id for update;
  select * into v_staff from private.staff_accounts where profile_id = v_profile_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision <> p_expected_revision
    or not private.staff_actor_ready(p_auth_user_id,v_staff.workspace_id,p_actor_session_id,true,true) then
    raise exception 'STAFF_PASSWORD_COMPLETION_FORBIDDEN' using errcode = '42501'; end if;
  update private.staff_accounts set password_change_required = false,auth_revision = gen_random_uuid(),
    sessions_valid_after = clock_timestamp(),updated_at = clock_timestamp() where profile_id = v_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    values(gen_random_uuid(),v_profile_id,'STAFF_PASSWORD_CHANGED',jsonb_build_object('workspaceId',v_staff.workspace_id));
end;
$$;

-- Exact grants: no caller can provision, revoke authority or complete onboarding.
revoke all on function private.staff_assert_owner(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.staff_account_summary(uuid) from public,anon,authenticated;
revoke all on function public.staff_list(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.staff_reserve_creation(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.staff_finalize_creation(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.staff_fail_creation(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.staff_update_account(uuid,uuid,uuid,uuid,uuid,public.app_role,text,boolean) from public,anon,authenticated;
revoke all on function public.staff_complete_password_change(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_list(uuid,uuid,uuid) to service_role;
grant execute on function public.staff_reserve_creation(uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.staff_finalize_creation(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.staff_fail_creation(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.staff_update_account(uuid,uuid,uuid,uuid,uuid,public.app_role,text,boolean) to service_role;
grant execute on function public.staff_complete_password_change(uuid,uuid,uuid) to service_role;
