-- Bind password completion to Auth state observed BEFORE independent final proof.
-- Fingerprints remain private equality sentinels; no credential/hash is returned.
alter table private.staff_accounts add column auth_password_fingerprint text
  check (auth_password_fingerprint is null or auth_password_fingerprint ~ '^[0-9a-f]{64}$');

create function private.staff_auth_password_fingerprint(p_auth_user_id uuid)
returns text language sql security definer set search_path = '' as $$
  select case when u.encrypted_password is not null and char_length(u.encrypted_password)>0
    then encode(extensions.digest(u.encrypted_password,'sha256'),'hex') else null end
  from auth.users u where u.id = p_auth_user_id;
$$;
revoke all on function private.staff_auth_password_fingerprint(uuid) from public,anon,authenticated,service_role;

create function private.staff_password_current(p_profile_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce(s.auth_password_fingerprint = private.staff_auth_password_fingerprint(s.auth_user_id),false)
    and s.auth_password_fingerprint is not null
  from private.staff_accounts s where s.profile_id = p_profile_id;
$$;
revoke all on function private.staff_password_current(uuid) from public,anon,authenticated,service_role;

create function private.staff_initialize_password_fingerprint()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_fingerprint text := private.staff_auth_password_fingerprint(new.auth_user_id);
begin
  if v_fingerprint is null then raise exception 'STAFF_AUTH_PASSWORD_UNAVAILABLE' using errcode='42501'; end if;
  update private.staff_accounts set auth_password_fingerprint=v_fingerprint where profile_id=new.profile_id;
  return new;
end;
$$;
revoke all on function private.staff_initialize_password_fingerprint() from public,anon,authenticated,service_role;
create trigger staff_initialize_password_fingerprint after insert on private.staff_accounts
  for each row execute function private.staff_initialize_password_fingerprint();

create table private.staff_password_claims (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references private.staff_accounts(profile_id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  auth_revision uuid not null,
  auth_password_fingerprint text not null check (auth_password_fingerprint ~ '^[0-9a-f]{64}$'),
  original_session_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at>created_at and expires_at<=created_at+interval '90 seconds')
);
create index staff_password_claims_expiry_idx on private.staff_password_claims(expires_at);
alter table private.staff_password_claims enable row level security;
revoke all on private.staff_password_claims from public,anon,authenticated,service_role;
-- Invoked definers own these rows. Server callers also receive only opaque claims.

create function public.staff_issue_password_claim(p_auth_user_id uuid,p_expected_revision uuid,p_actor_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; v_staff private.staff_accounts; v_claim private.staff_password_claims;
  v_fingerprint text; v_now timestamptz;
begin
  select id into v_profile_id from public.profiles where auth_user_id=p_auth_user_id for update;
  select * into v_staff from private.staff_accounts where profile_id=v_profile_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision<>p_expected_revision
    or not private.staff_actor_ready(p_auth_user_id,v_staff.workspace_id,p_actor_session_id,true,true) then
    raise exception 'STAFF_PASSWORD_CLAIM_FORBIDDEN' using errcode='42501'; end if;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_fingerprint is null then raise exception 'STAFF_PASSWORD_CLAIM_FORBIDDEN' using errcode='42501'; end if;
  v_now := clock_timestamp();
  -- Bound retained state; a claim can be used only within its own 90-second window.
  delete from private.staff_password_claims where expires_at<=clock_timestamp();
  insert into private.staff_password_claims(profile_id,auth_user_id,auth_revision,auth_password_fingerprint,
    original_session_id,created_at,expires_at)
  values(v_profile_id,p_auth_user_id,p_expected_revision,v_fingerprint,p_actor_session_id,v_now,v_now+interval '90 seconds')
  returning * into v_claim;
  return jsonb_build_object('claimId',v_claim.id,'expiresAt',v_claim.expires_at);
end;
$$;
revoke all on function public.staff_issue_password_claim(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_issue_password_claim(uuid,uuid,uuid) to service_role;

drop function public.staff_complete_password_change(uuid,uuid,uuid);
create function public.staff_complete_password_change(p_auth_user_id uuid,p_expected_revision uuid,p_actor_session_id uuid,p_claim_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; v_staff private.staff_accounts; v_claim private.staff_password_claims;
  v_fingerprint text;
begin
  select id into v_profile_id from public.profiles where auth_user_id=p_auth_user_id for update;
  select * into v_staff from private.staff_accounts where profile_id=v_profile_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision<>p_expected_revision
    or not private.staff_actor_ready(p_auth_user_id,v_staff.workspace_id,p_actor_session_id,true,true) then
    raise exception 'STAFF_PASSWORD_COMPLETION_FORBIDDEN' using errcode='42501'; end if;
  select * into v_claim from private.staff_password_claims where id=p_claim_id for update;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_claim.id is null or v_claim.profile_id<>v_profile_id or v_claim.auth_user_id<>p_auth_user_id
    or v_claim.auth_revision<>p_expected_revision or v_claim.consumed_at is not null
    or v_claim.expires_at<=clock_timestamp() or p_actor_session_id=v_claim.original_session_id
    or v_fingerprint is null or v_fingerprint<>v_claim.auth_password_fingerprint
    or not exists(select 1 from auth.sessions s where s.id=p_actor_session_id and s.user_id=p_auth_user_id
      and s.created_at>=v_claim.created_at and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'STAFF_PASSWORD_COMPLETION_FORBIDDEN' using errcode='42501'; end if;
  update private.staff_password_claims set consumed_at=clock_timestamp() where id=v_claim.id;
  update private.staff_accounts set password_change_required=false,auth_revision=gen_random_uuid(),
    auth_password_fingerprint=v_fingerprint,sessions_valid_after=clock_timestamp(),updated_at=clock_timestamp()
    where profile_id=v_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    values(gen_random_uuid(),v_profile_id,'STAFF_PASSWORD_CHANGED',jsonb_build_object('workspaceId',v_staff.workspace_id));
end;
$$;
revoke all on function public.staff_complete_password_change(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_complete_password_change(uuid,uuid,uuid,uuid) to service_role;

-- Overrides retain unmanaged Owner/Guest behavior and require current Auth state
-- for managed business access. Only onboarding bypasses the pending/mismatch gate.
create or replace function private.staff_actor_ready(
  p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid,
  p_lock boolean default false, p_allow_password_pending boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_staff private.staff_accounts; v_fingerprint text;
begin
  if p_auth_user_id is null then return false; end if;
  if p_lock then
    select * into v_profile from public.profiles where auth_user_id = p_auth_user_id for share;
  else
    select * into v_profile from public.profiles where auth_user_id = p_auth_user_id;
  end if;
  if v_profile.id is null or not v_profile.active then return false; end if;
  if p_lock then
    select * into v_staff from private.staff_accounts where profile_id = v_profile.id for share;
  else
    select * into v_staff from private.staff_accounts where profile_id = v_profile.id;
  end if;
  if v_staff.profile_id is null then return true; end if;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_fingerprint is null then return false; end if;
  if v_profile.platform_role <> 'USER' or v_profile.demo_principal
    or v_staff.auth_user_id <> p_auth_user_id
    or (p_workspace_id is not null and p_workspace_id <> v_staff.workspace_id)
    or (not p_allow_password_pending and (v_staff.password_change_required
      or not coalesce(private.staff_password_current(v_profile.id),false)))
    or p_session_id is null then return false; end if;
  if p_lock then
    perform 1 from public.workspace_memberships m
      where m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active for share;
  else
    perform 1 from public.workspace_memberships m
      where m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active;
  end if;
  if not found then return false; end if;
  return exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    join public.workspaces w on w.id = v_staff.workspace_id
    where s.id = p_session_id and s.user_id = p_auth_user_id
      and s.created_at > v_staff.sessions_valid_after
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.is_anonymous is false and w.active and w.kind = 'OWNER'
  );
end;
$$;

create or replace function public.staff_session_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_staff private.staff_accounts;
  v_auth_user_id uuid := (select auth.uid()); v_session_id uuid := private.staff_signed_session_id();
begin
  if v_auth_user_id is null then raise exception 'STAFF_UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where auth_user_id = v_auth_user_id;
  if v_profile.id is null then
    return jsonb_build_object('isManaged',false,'passwordChangeRequired',false,
      'sessionAllowed',false,'authRevision',null,'sessionId',v_session_id);
  end if;
  select * into v_staff from private.staff_accounts where profile_id = v_profile.id;
  return jsonb_build_object('isManaged',v_staff.profile_id is not null,
    'passwordChangeRequired',case when v_staff.profile_id is not null then
      v_staff.password_change_required or not coalesce(private.staff_password_current(v_profile.id),false) else false end,
    'sessionAllowed',private.staff_actor_ready(v_auth_user_id,v_staff.workspace_id,v_session_id,false,true),
    'authRevision',v_staff.auth_revision,'sessionId',v_session_id);
end;
$$;

create or replace function private.staff_account_summary(p_profile_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('profileId',p.id,'name',p.display_name,'email',s.email,
    'role',m.role,'branchCode',case when m.role = 'TECHNICIAN' then b.code else null end,
    'active',p.active and m.active,'passwordChangeRequired',
      s.password_change_required or not coalesce(private.staff_password_current(s.profile_id),false),
    'authRevision',s.auth_revision)
  from private.staff_accounts s join public.profiles p on p.id = s.profile_id
    join public.workspace_memberships m on m.profile_id = s.profile_id and m.workspace_id = s.workspace_id
    left join public.workspace_technicians t on t.profile_id = s.profile_id and t.workspace_id = s.workspace_id
    left join public.workspace_branches b on b.id = t.branch_id and b.workspace_id = t.workspace_id
  where s.profile_id = p_profile_id;
$$;
