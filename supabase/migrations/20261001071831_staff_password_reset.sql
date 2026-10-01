-- Owner initiated staff password resets. Auth credentials never enter this ledger.
create table private.staff_password_resets (
  id uuid primary key,
  owner_profile_id uuid not null references public.profiles(id),
  workspace_id uuid not null references public.workspaces(id),
  profile_id uuid not null references private.staff_accounts(profile_id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expected_revision uuid not null,
  reset_revision uuid not null,
  initial_fingerprint text not null check (initial_fingerprint ~ '^[0-9a-f]{64}$'),
  claim_token uuid not null default gen_random_uuid(),
  claim_expires_at timestamptz not null,
  state text not null default 'RESERVED' check (state in ('RESERVED','RESET')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (claim_expires_at > created_at)
);
create index staff_password_resets_expiry_idx on private.staff_password_resets(claim_expires_at)
  where state = 'RESERVED';
alter table private.staff_password_resets enable row level security;
revoke all on private.staff_password_resets from public,anon,authenticated,service_role;

-- Runs only after the caller has locked the target profile, staff account and
-- membership in that order. The Auth operation marker plus a changed private
-- fingerprint proves that Auth applied this operation without retaining a password.
create function private.staff_password_reset_reconcile(
  p_request_key uuid,p_owner_profile_id uuid,p_workspace_id uuid,p_profile_id uuid,
  p_claim_token uuid default null,p_require_live_claim boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_operation private.staff_password_resets; v_staff private.staff_accounts;
  v_fingerprint text; v_marker text;
begin
  select * into v_operation from private.staff_password_resets where id=p_request_key for update;
  if v_operation.id is null or v_operation.owner_profile_id<>p_owner_profile_id
    or v_operation.workspace_id<>p_workspace_id or v_operation.profile_id<>p_profile_id
    or (p_require_live_claim and (p_claim_token is null or v_operation.claim_token<>p_claim_token
      or v_operation.claim_expires_at<=clock_timestamp())) then
    raise exception 'STAFF_REQUEST_CONFLICT' using errcode='40001';
  end if;
  if v_operation.state='RESET' then
    return jsonb_build_object('state','RESET','account',private.staff_account_summary(p_profile_id));
  end if;
  select * into v_staff from private.staff_accounts where profile_id=p_profile_id;
  if v_staff.profile_id is null or v_staff.auth_user_id<>v_operation.auth_user_id
    or v_staff.auth_revision<>v_operation.reset_revision then
    raise exception 'STAFF_STALE_ACCOUNT' using errcode='40001';
  end if;
  v_fingerprint := private.staff_auth_password_fingerprint(v_operation.auth_user_id);
  select u.raw_app_meta_data->>'sejukops_staff_password_reset' into v_marker
    from auth.users u where u.id=v_operation.auth_user_id;
  if v_marker=v_operation.id::text and v_fingerprint is not null
    and v_fingerprint<>v_operation.initial_fingerprint then
    update private.staff_accounts set password_change_required=true,
      auth_password_fingerprint=v_fingerprint,updated_at=clock_timestamp()
      where profile_id=p_profile_id and auth_revision=v_operation.reset_revision;
    update private.staff_password_resets set state='RESET',updated_at=clock_timestamp()
      where id=v_operation.id and state='RESERVED';
    insert into public.audit_logs(id,actor_profile_id,event_type,idempotency_key,metadata_json)
      values(gen_random_uuid(),p_owner_profile_id,'STAFF_PASSWORD_RESET',p_request_key::text||':reset',
        jsonb_build_object('workspaceId',p_workspace_id,'profileId',p_profile_id))
      on conflict(idempotency_key) do nothing;
    return jsonb_build_object('state','RESET','account',private.staff_account_summary(p_profile_id));
  end if;
  return jsonb_build_object('state','NOT_APPLIED');
end;
$$;
revoke all on function private.staff_password_reset_reconcile(uuid,uuid,uuid,uuid,uuid,boolean)
  from public,anon,authenticated,service_role;

create function public.staff_reserve_password_reset(
  p_owner_auth_user_id uuid,p_owner_session_id uuid,p_workspace_id uuid,p_profile_id uuid,
  p_expected_revision uuid,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_profile public.profiles; v_staff private.staff_accounts;
  v_membership public.workspace_memberships; v_operation private.staff_password_resets;
  v_reconciled jsonb; v_fingerprint text; v_reset_revision uuid;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  if p_request_key is null or p_profile_id is null or p_expected_revision is null then
    raise exception 'STAFF_INVALID_INPUT' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-password-reset:'||p_request_key::text,0));
  select * into v_profile from public.profiles where id=p_profile_id for update;
  select * into v_staff from private.staff_accounts where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  select * into v_membership from public.workspace_memberships
    where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  if v_profile.id is null or v_staff.profile_id is null or v_membership.profile_id is null
    or v_profile.auth_user_id is distinct from v_staff.auth_user_id
    or v_profile.platform_role<>'USER' or v_profile.demo_principal then
    raise exception 'STAFF_WORKSPACE_FORBIDDEN' using errcode='42501';
  end if;
  select * into v_operation from private.staff_password_resets where id=p_request_key;
  if v_operation.id is not null then
    if v_operation.owner_profile_id<>v_owner or v_operation.workspace_id<>p_workspace_id
      or v_operation.profile_id<>p_profile_id or v_operation.auth_user_id<>v_staff.auth_user_id
      or v_operation.expected_revision<>p_expected_revision then
      raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505';
    end if;
    v_reconciled := private.staff_password_reset_reconcile(p_request_key,v_owner,p_workspace_id,p_profile_id);
    if v_reconciled->>'state'='RESET' then
      return jsonb_build_object('state','RESET','account',v_reconciled->'account');
    end if;
    select * into v_operation from private.staff_password_resets where id=p_request_key for update;
    if v_operation.claim_expires_at>clock_timestamp() then
      raise exception 'STAFF_BUSY' using errcode='55P03';
    end if;
    update private.staff_password_resets set claim_token=gen_random_uuid(),
      claim_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
      where id=p_request_key returning * into v_operation;
    return jsonb_build_object('state','RESERVED','operationId',v_operation.id,'claimToken',v_operation.claim_token,
      'targetAuthUserId',v_operation.auth_user_id,'targetProfileId',v_operation.profile_id,
      'resetRevision',v_operation.reset_revision);
  end if;
  if v_staff.auth_revision<>p_expected_revision then
    raise exception 'STAFF_STALE_ACCOUNT' using errcode='40001';
  end if;
  v_fingerprint := private.staff_auth_password_fingerprint(v_staff.auth_user_id);
  if v_fingerprint is null then raise exception 'STAFF_AUTH_PASSWORD_UNAVAILABLE' using errcode='42501'; end if;
  v_reset_revision := gen_random_uuid();
  insert into private.staff_password_resets(id,owner_profile_id,workspace_id,profile_id,auth_user_id,
    expected_revision,reset_revision,initial_fingerprint,claim_expires_at)
    values(p_request_key,v_owner,p_workspace_id,p_profile_id,v_staff.auth_user_id,p_expected_revision,
      v_reset_revision,v_fingerprint,clock_timestamp()+interval '2 minutes') returning * into v_operation;
  -- Revoke old sessions and claims before any Auth mutation. If Auth is uncertain,
  -- the account remains blocked until this exact operation is reconciled or retried.
  update private.staff_accounts set password_change_required=true,auth_revision=v_reset_revision,
    sessions_valid_after=clock_timestamp(),updated_at=clock_timestamp() where profile_id=p_profile_id;
  delete from private.staff_password_claims where profile_id=p_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,idempotency_key,metadata_json)
    values(gen_random_uuid(),v_owner,'STAFF_PASSWORD_RESET_RESERVED',p_request_key::text||':reserved',
      jsonb_build_object('workspaceId',p_workspace_id,'profileId',p_profile_id));
  return jsonb_build_object('state','RESERVED','operationId',v_operation.id,'claimToken',v_operation.claim_token,
    'targetAuthUserId',v_operation.auth_user_id,'targetProfileId',v_operation.profile_id,
    'resetRevision',v_operation.reset_revision);
end;
$$;

create function public.staff_finalize_password_reset(
  p_owner_auth_user_id uuid,p_owner_session_id uuid,p_workspace_id uuid,p_profile_id uuid,
  p_request_key uuid,p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_profile public.profiles; v_staff private.staff_accounts;
  v_membership public.workspace_memberships; v_result jsonb;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_profile from public.profiles where id=p_profile_id for update;
  select * into v_staff from private.staff_accounts where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  select * into v_membership from public.workspace_memberships
    where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  if v_profile.id is null or v_staff.profile_id is null or v_membership.profile_id is null then
    raise exception 'STAFF_WORKSPACE_FORBIDDEN' using errcode='42501';
  end if;
  v_result := private.staff_password_reset_reconcile(p_request_key,v_owner,p_workspace_id,p_profile_id,p_claim_token,true);
  if v_result->>'state'<>'RESET' then
    raise exception 'STAFF_AUTH_NOT_READY' using errcode='42501';
  end if;
  return v_result->'account';
end;
$$;

revoke all on function public.staff_reserve_password_reset(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.staff_finalize_password_reset(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_reserve_password_reset(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.staff_finalize_password_reset(uuid,uuid,uuid,uuid,uuid,uuid) to service_role;
