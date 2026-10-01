-- Staff foundation only. No Auth creation, application provisioning, or data reset.
-- State lives in private tables; caller access is through narrowly scoped functions.
create table private.staff_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  email text not null unique check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  password_change_required boolean not null default true,
  auth_revision uuid not null default gen_random_uuid(),
  sessions_valid_after timestamptz not null default 'epoch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly these non-secret form fields are allowed. Passwords cannot enter the ledger.
create function private.staff_input_valid(p_input jsonb, p_email text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_input) = 'object'
    and p_input ?& array['name','email','role','branchCode']
    and (p_input - array['name','email','role','branchCode']) = '{}'::jsonb
    and jsonb_typeof(p_input->'name') = 'string'
    and char_length(btrim(p_input->>'name')) between 1 and 100
    and p_input->>'email' = p_email
    and jsonb_typeof(p_input->'role') = 'string'
    and p_input->>'role' in ('ADMIN','MANAGER','TECHNICIAN')
    and case when p_input->>'role' = 'TECHNICIAN' then
      jsonb_typeof(p_input->'branchCode') = 'string'
      and char_length(p_input->>'branchCode') between 1 and 32
      and p_input->>'branchCode' ~ '^[A-Za-z0-9_-]+$'
    else p_input->'branchCode' = 'null'::jsonb end,
    false);
$$;

create table private.staff_provisioning (
  id uuid primary key,
  owner_profile_id uuid not null references public.profiles(id),
  workspace_id uuid not null references public.workspaces(id),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  email text not null unique check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  target_auth_user_id uuid not null unique,
  target_profile_id uuid not null unique,
  input jsonb not null,
  state text not null default 'RESERVED' check (state in ('RESERVED','CREATED','FAILED')),
  claim_token uuid not null default gen_random_uuid(),
  claim_expires_at timestamptz not null,
  last_error_code text check (last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (private.staff_input_valid(input, email)),
  check (claim_expires_at > created_at)
);
alter table private.staff_accounts enable row level security;
alter table private.staff_provisioning enable row level security;
revoke all on private.staff_accounts, private.staff_provisioning from public, anon, authenticated;
grant all on private.staff_accounts, private.staff_provisioning to service_role;
revoke all on function private.staff_input_valid(jsonb,text) from public, anon, authenticated;
grant execute on function private.staff_input_valid(jsonb,text) to service_role;

-- A managed identity may never be converted into Owner/Guest or another workspace.
-- Zero memberships during construction grants no authority; PK + fixed workspace
-- prevent a second membership. Provisioning finalization supplies the one membership.
create function private.staff_identity_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff private.staff_accounts; v_profile public.profiles;
begin
  if tg_table_name = 'staff_accounts' then
    if tg_op = 'UPDATE' and (new.profile_id, new.auth_user_id, new.workspace_id, new.email)
      is distinct from (old.profile_id, old.auth_user_id, old.workspace_id, old.email) then
      raise exception 'STAFF_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;
    select * into v_profile from public.profiles where id = new.profile_id for share;
    if v_profile.id is null or v_profile.auth_user_id is distinct from new.auth_user_id
      or v_profile.platform_role <> 'USER' or v_profile.demo_principal
      or not exists (select 1 from auth.users u where u.id = new.auth_user_id and u.is_anonymous is false)
      or not exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.kind = 'OWNER')
      or exists (select 1 from public.workspace_memberships m where m.profile_id = new.profile_id and m.workspace_id <> new.workspace_id) then
      raise exception 'STAFF_IDENTITY_INVALID' using errcode = '23514';
    end if;
  elsif tg_table_name = 'profiles' then
    select * into v_staff from private.staff_accounts where profile_id = old.id;
    if v_staff.profile_id is not null and (new.id is distinct from old.id
      -- Preserve the pre-existing Auth FK ON DELETE SET NULL. A surviving Auth
      -- identity cannot be unlinked; an already deleted parent may cascade.
      or (new.auth_user_id is distinct from v_staff.auth_user_id and
        (new.auth_user_id is not null or exists (select 1 from auth.users where id = v_staff.auth_user_id)))
      or new.platform_role <> 'USER' or new.demo_principal) then
      raise exception 'STAFF_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;
  elsif tg_table_name = 'workspace_memberships' then
    select * into v_staff from private.staff_accounts where profile_id = new.profile_id;
    if v_staff.profile_id is not null and new.workspace_id <> v_staff.workspace_id then
      raise exception 'STAFF_WORKSPACE_IMMUTABLE' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id
      and exists (select 1 from private.staff_accounts where profile_id = old.profile_id) then
      raise exception 'STAFF_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.staff_identity_guard() from public, anon, authenticated;
create trigger staff_accounts_identity_guard before insert or update on private.staff_accounts
  for each row execute function private.staff_identity_guard();
create trigger profiles_staff_identity_guard before update on public.profiles
  for each row execute function private.staff_identity_guard();
create trigger workspace_memberships_staff_identity_guard before insert or update on public.workspace_memberships
  for each row execute function private.staff_identity_guard();

-- Parse only the signed top-level claim, never user_metadata. Malformed claims fail closed.
create function private.staff_signed_session_id()
returns uuid language plpgsql stable set search_path = '' as $$
declare v_claim text := (select auth.jwt()->>'session_id');
begin
  if v_claim is null or v_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return v_claim::uuid;
end;
$$;
revoke all on function private.staff_signed_session_id() from public, anon, authenticated;

-- p_lock is for consequential functions: profile -> staff -> membership locks
-- stabilize authority through their commit and order against management updates.
-- Unmanaged existing Owner/Guest profiles retain their prior active-state behavior.
create function private.staff_actor_ready(
  p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid,
  p_lock boolean default false, p_allow_password_pending boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_staff private.staff_accounts;
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
  if v_profile.platform_role <> 'USER' or v_profile.demo_principal
    or v_staff.auth_user_id <> p_auth_user_id
    or (p_workspace_id is not null and p_workspace_id <> v_staff.workspace_id)
    or (v_staff.password_change_required and not p_allow_password_pending)
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
revoke all on function private.staff_actor_ready(uuid,uuid,uuid,boolean,boolean) from public, anon, authenticated;

create function private.staff_current_actor_ready(p_workspace_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select private.staff_actor_ready((select auth.uid()), p_workspace_id,
    private.staff_signed_session_id(), false, false);
$$;
revoke all on function private.staff_current_actor_ready(uuid) from public, anon, authenticated;
grant execute on function private.staff_current_actor_ready(uuid) to authenticated, service_role;

create function private.staff_require_actor(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.staff_actor_ready(p_auth_user_id, p_workspace_id, p_session_id, true, false) then
    raise exception 'STAFF_BUSINESS_FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.staff_require_actor(uuid,uuid,uuid) from public, anon, authenticated;

-- Safe self-only onboarding status; email and internal provisioning state are absent.
create function public.staff_session_status()
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
    'passwordChangeRequired',coalesce(v_staff.password_change_required,false),
    'sessionAllowed',private.staff_actor_ready(v_auth_user_id,v_staff.workspace_id,v_session_id,false,true),
    'authRevision',v_staff.auth_revision,'sessionId',v_session_id);
end;
$$;
revoke all on function public.staff_session_status() from public, anon, authenticated;
grant execute on function public.staff_session_status() to authenticated;

-- Restrictive fences intersect every existing SELECT policy; none broadens access.
-- Profiles intentionally retain onboarding/self lookup while business rows are denied.

create policy workspaces_staff_readiness on public.workspaces
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(id));

create policy workspace_memberships_staff_readiness on public.workspace_memberships
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy workspace_branches_staff_readiness on public.workspace_branches
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy workspace_customers_staff_readiness on public.workspace_customers
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy workspace_technicians_staff_readiness on public.workspace_technicians
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy workspace_orders_staff_readiness on public.workspace_orders
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy workspace_assignment_proposals_staff_readiness on public.workspace_assignment_proposals
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy knowledge_documents_staff_readiness on public.knowledge_documents
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy knowledge_versions_staff_readiness on public.knowledge_versions
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy knowledge_chunks_staff_readiness on public.knowledge_chunks
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

create policy knowledge_version_pages_staff_readiness on public.knowledge_version_pages
  as restrictive for select to authenticated
  using (private.staff_current_actor_ready(workspace_id));

-- Existing authorization is preserved after this staff readiness/locking preflight.
CREATE OR REPLACE FUNCTION private.knowledge_editor(p_workspace_id uuid, p_generation bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
  if (select auth.uid()) is null then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id into v_profile_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid()) and p.active
    and m.workspace_id = p_workspace_id and m.active
    and m.role in ('ADMIN', 'MANAGER')
    and w.active and w.generation = p_generation
    and ((select (auth.jwt()->>'is_anonymous')::boolean) is false or w.kind = 'DEMO')
  for share of w;
  if v_profile_id is null then
    raise exception 'KNOWLEDGE_FORBIDDEN_OR_STALE' using errcode = '42501';
  end if;
  return v_profile_id;
end;
$$;

-- Existing authorization is preserved after this staff readiness/locking preflight.
CREATE OR REPLACE FUNCTION private.workspace_order_admin_profile(p_workspace_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
  if (select auth.uid()) is null
    or (select (auth.jwt()->>'is_anonymous')::boolean) is not false then
    raise exception 'WORKSPACE_ORDER_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id into v_profile_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid()) and p.active and not p.demo_principal
    and m.active and m.workspace_id = p_workspace_id and m.role = 'ADMIN'
    and w.active;
  if v_profile_id is null then
    raise exception 'WORKSPACE_ORDER_FORBIDDEN' using errcode = '42501';
  end if;
  return v_profile_id;
end;
$$;

-- Existing authorization is preserved after this staff readiness/locking preflight.
CREATE OR REPLACE FUNCTION private.workspace_order_manual_actor(p_workspace_id uuid, p_expected_generation bigint, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_kind public.workspace_kind;
  v_generation bigint;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
  if (select auth.uid()) is null
    or (select (auth.jwt()->>'is_anonymous')::boolean) is not false then
    raise exception 'WORKSPACE_ORDER_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id, p.demo_principal, w.kind
  into v_profile_id, v_demo_principal, v_kind
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid()) and p.active
    and m.active and m.workspace_id = p_workspace_id and m.role = 'ADMIN'
    and w.active and (not p.demo_principal
      or (p.role = 'ADMIN' and p.platform_role = 'USER'));
  if v_profile_id is null then
    raise exception 'WORKSPACE_ORDER_FORBIDDEN' using errcode = '42501';
  end if;
  select w.generation into v_generation from public.workspaces w
  where w.id = p_workspace_id and w.active for share;
  if v_generation is null or p_expected_generation is null
    or v_generation <> p_expected_generation then
    raise exception 'WORKSPACE_GENERATION_STALE' using errcode = 'P0001';
  end if;
  if v_demo_principal then
    if v_kind <> 'DEMO' or p_guest_visit_id is null
      or p_guest_token_hash is null or not exists (
        select 1 from public.guest_visits v
        where v.id = p_guest_visit_id and v.token_hash = p_guest_token_hash
          and v.workspace_id = p_workspace_id and v.demo_generation = v_generation
          and v.persona = 'ADMIN' and v.revoked_at is null
          and v.expires_at > pg_catalog.clock_timestamp()
        for share
      ) then
      raise exception 'WORKSPACE_GUEST_VISIT_INVALID' using errcode = '42501';
    end if;
  elsif p_guest_visit_id is not null or p_guest_token_hash is not null then
    raise exception 'WORKSPACE_GUEST_VISIT_FORBIDDEN' using errcode = '42501';
  end if;
  return v_profile_id;
end;
$$;

-- Existing authorization is preserved after this staff readiness/locking preflight.
CREATE OR REPLACE FUNCTION private.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_workspace_kind public.workspace_kind;
  v_generation bigint;
  v_previous_schedule timestamptz;
  v_order public.workspace_orders;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
  if (select auth.uid()) is null or p_expected_updated_at is null
    or p_scheduled_at is null
    or (select (auth.jwt()->>'is_anonymous')::boolean) is not false then
    raise exception 'WORKSPACE_RESCHEDULE_FORBIDDEN_OR_INVALID' using errcode = '42501';
  end if;

  select p.id, p.demo_principal, w.kind into v_profile_id, v_demo_principal, v_workspace_kind
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid()) and p.active
    and m.active and m.role = 'MANAGER'
    and m.workspace_id = p_workspace_id and w.active
    and (not p.demo_principal or (p.role = 'MANAGER' and w.kind = 'DEMO'));
  if v_profile_id is null then
    raise exception 'WORKSPACE_RESCHEDULE_FORBIDDEN' using errcode = '42501';
  end if;

  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null or p_expected_generation is null
    or v_generation <> p_expected_generation then
    raise exception 'WORKSPACE_GENERATION_STALE' using errcode = 'P0001';
  end if;

  if v_demo_principal then
    if v_workspace_kind <> 'DEMO' or p_guest_visit_id is null or p_guest_token_hash is null
      or not exists (
        select 1 from public.guest_visits v
        where v.id = p_guest_visit_id and v.token_hash = p_guest_token_hash
          and v.workspace_id = p_workspace_id and v.demo_generation = v_generation
          and v.persona = 'MANAGER' and v.revoked_at is null
          and v.expires_at > pg_catalog.clock_timestamp()
        for share
      ) then
      raise exception 'WORKSPACE_GUEST_VISIT_INVALID' using errcode = '42501';
    end if;
  elsif p_guest_visit_id is not null or p_guest_token_hash is not null then
    raise exception 'WORKSPACE_GUEST_VISIT_FORBIDDEN' using errcode = '42501';
  end if;

  select o.scheduled_at into v_previous_schedule from public.workspace_orders o
  where o.workspace_id = p_workspace_id and o.id = p_order_id
    and o.updated_at = p_expected_updated_at for update;
  update public.workspace_orders o
  set scheduled_at = p_scheduled_at,
      updated_at = greatest(clock_timestamp(), o.updated_at + interval '1 microsecond')
  where o.workspace_id = p_workspace_id and o.id = p_order_id
    and o.updated_at = p_expected_updated_at and o.status = 'ASSIGNED'
    and o.assigned_technician_id is not null
    and o.scheduled_at is distinct from p_scheduled_at
  returning * into v_order;
  if v_order.id is null then
    raise exception 'WORKSPACE_RESCHEDULE_STALE_OR_UNAVAILABLE' using errcode = 'P0001';
  end if;
  insert into private.workspace_order_schedule_audit (
    workspace_id, workspace_generation, order_id, actor_profile_id,
    guest_visit_id, source, from_scheduled_at, to_scheduled_at
  ) values (
    p_workspace_id, v_generation, p_order_id, v_profile_id,
    p_guest_visit_id, case when v_demo_principal then 'GUEST' else 'ACCOUNT' end,
    v_previous_schedule, p_scheduled_at
  );
  return v_order;
end;
$$;

-- Existing authorization is preserved after this staff readiness/locking preflight.
CREATE OR REPLACE FUNCTION private.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_persona public.app_role;
  v_workspace_kind public.workspace_kind;
  v_generation bigint;
  v_old_status public.service_order_status;
  v_order public.workspace_orders;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
  if (select auth.uid()) is null or p_expected_updated_at is null
    or p_next_status is null or p_next_status not in ('IN_PROGRESS', 'COMPLETED')
    or (select (auth.jwt()->>'is_anonymous')::boolean) is not false then
    raise exception 'WORKSPACE_JOB_FORBIDDEN_OR_INVALID' using errcode = '42501';
  end if;

  select p.id, p.demo_principal, m.role, w.kind
  into v_profile_id, v_demo_principal, v_persona, v_workspace_kind
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid())
    and p.active and m.active and w.active
    and m.workspace_id = p_workspace_id and m.role = 'TECHNICIAN'
    and (not p.demo_principal or p.role = 'TECHNICIAN');
  if v_profile_id is null then
    raise exception 'WORKSPACE_JOB_FORBIDDEN' using errcode = '42501';
  end if;

  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null or p_expected_generation is null
    or v_generation <> p_expected_generation then
    raise exception 'WORKSPACE_GENERATION_STALE' using errcode = 'P0001';
  end if;

  if v_demo_principal then
    if v_workspace_kind <> 'DEMO' or p_guest_visit_id is null
      or p_guest_token_hash is null or not exists (
        select 1 from public.guest_visits v
        where v.id = p_guest_visit_id and v.token_hash = p_guest_token_hash
          and v.workspace_id = p_workspace_id and v.demo_generation = v_generation
          and v.persona = v_persona and v.revoked_at is null
          and v.expires_at > pg_catalog.clock_timestamp()
        for share
      ) then
      raise exception 'WORKSPACE_GUEST_VISIT_INVALID' using errcode = '42501';
    end if;
  elsif p_guest_visit_id is not null or p_guest_token_hash is not null then
    raise exception 'WORKSPACE_GUEST_VISIT_FORBIDDEN' using errcode = '42501';
  end if;

  select o.status into v_old_status from public.workspace_orders o
  where o.workspace_id = p_workspace_id and o.id = p_order_id
    and o.updated_at = p_expected_updated_at for update;

  update public.workspace_orders o
  set status = p_next_status,
      updated_at = greatest(clock_timestamp(), o.updated_at + interval '1 microsecond')
  where o.workspace_id = p_workspace_id and o.id = p_order_id
    and o.updated_at = p_expected_updated_at
    and ((o.status = 'ASSIGNED' and p_next_status = 'IN_PROGRESS')
      or (o.status = 'IN_PROGRESS' and p_next_status = 'COMPLETED'))
    and exists (
      select 1 from public.workspace_technicians t
      where t.workspace_id = o.workspace_id and t.id = o.assigned_technician_id
        and t.profile_id = v_profile_id and t.active
    )
  returning * into v_order;
  if v_order.id is null then
    raise exception 'WORKSPACE_JOB_STALE_OR_UNAVAILABLE' using errcode = 'P0001';
  end if;
  insert into private.workspace_order_activity_audit (
    workspace_id, workspace_generation, order_id, actor_profile_id,
    guest_visit_id, source, from_status, to_status
  ) values (
    p_workspace_id, v_generation, p_order_id, v_profile_id,
    p_guest_visit_id, case when v_demo_principal then 'GUEST' else 'ACCOUNT' end,
    v_old_status, p_next_status
  );
  return v_order;
end;
$$;

CREATE OR REPLACE FUNCTION private.workspace_assignment_proposal_insert(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_profile_id uuid, p_source_client text) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_generation bigint;
  v_order public.workspace_orders;
  v_payload jsonb;
  v_proposal public.workspace_assignment_proposals;
begin
  perform private.staff_require_actor(
    (select p.auth_user_id from public.profiles p where p.id = p_initiator_profile_id),
    p_workspace_id, case when (select auth.uid()) =
      (select p.auth_user_id from public.profiles p where p.id = p_initiator_profile_id)
      then private.staff_signed_session_id() else null end);
  if p_source_client is null or p_source_client not in ('WEB', 'MCP') or p_idempotency_key is null
     or p_expected_updated_at is null or p_initiator_profile_id is null then
    raise exception 'PROPOSAL_INPUT_INVALID' using errcode = '22023';
  end if;
  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null then
    raise exception 'PROPOSAL_WORKSPACE_UNAVAILABLE' using errcode = '42501';
  end if;
  -- Serialize retries for this actor. Recheck active state after the lock.
  perform 1 from public.workspace_memberships
  where workspace_id = p_workspace_id and profile_id = p_initiator_profile_id
    and active and role = 'ADMIN' for update;
  if not found then
    raise exception 'PROPOSAL_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    join public.workspaces w on w.id = p_workspace_id
    where p.id = p_initiator_profile_id and p.active and w.active
      and (coalesce(u.is_anonymous, false) is false or w.kind = 'DEMO')
  ) then
    raise exception 'PROPOSAL_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  v_payload := pg_catalog.jsonb_build_object(
    'orderId', p_order_id,
    'technicianId', p_technician_id,
    'scheduledAt', p_scheduled_at
  );
  -- Identical retries return the durable record without another audit event.
  select * into v_proposal from public.workspace_assignment_proposals
  where workspace_id = p_workspace_id
    and initiated_by_profile_id = p_initiator_profile_id
    and idempotency_key = p_idempotency_key;
  if v_proposal.id is not null then
    if v_proposal.target_order_id <> p_order_id
       or v_proposal.target_updated_at <> p_expected_updated_at
       or v_proposal.canonical_payload <> v_payload then
      raise exception 'PROPOSAL_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return v_proposal;
  end if;

  select * into v_order from public.workspace_orders
  where workspace_id = p_workspace_id and id = p_order_id for share;
  if v_order.id is null or v_order.updated_at <> p_expected_updated_at
     or v_order.status not in ('NEW', 'ASSIGNED') then
    raise exception 'PROPOSAL_TARGET_STALE' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.workspace_technicians t
    join public.workspace_memberships m
      on m.workspace_id = t.workspace_id and m.profile_id = t.profile_id
    join public.profiles p on p.id = t.profile_id
    where t.workspace_id = p_workspace_id and t.id = p_technician_id
      and t.branch_id = v_order.branch_id and t.active
      and m.active and m.role = 'TECHNICIAN' and p.active
  ) then
    raise exception 'PROPOSAL_TECHNICIAN_UNAVAILABLE' using errcode = '23503';
  end if;

  insert into public.workspace_assignment_proposals (
    workspace_id, initiated_by_profile_id, idempotency_key,
    canonical_payload, target_order_id, target_updated_at,
    dataset_generation, expires_at
  ) values (
    p_workspace_id, p_initiator_profile_id, p_idempotency_key,
    v_payload, p_order_id, v_order.updated_at,
    v_generation, clock_timestamp() + interval '15 minutes'
  ) on conflict (workspace_id, initiated_by_profile_id, idempotency_key) do nothing
  returning * into v_proposal;

  if v_proposal.id is null then
    select * into v_proposal from public.workspace_assignment_proposals
    where workspace_id = p_workspace_id
      and initiated_by_profile_id = p_initiator_profile_id
      and idempotency_key = p_idempotency_key;
    if v_proposal.target_order_id <> p_order_id
       or v_proposal.target_updated_at <> p_expected_updated_at
       or v_proposal.canonical_payload <> v_payload then
      raise exception 'PROPOSAL_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return v_proposal;
  end if;

  insert into public.workspace_assignment_proposal_audit (
    workspace_id, proposal_id, initiator_profile_id,
    event_type, source_client, target_order_id, outcome
  ) values (
    p_workspace_id, v_proposal.id, p_initiator_profile_id,
    'PROPOSED', p_source_client, p_order_id, 'PENDING'
  );
  return v_proposal;
end;
$$;

-- Existing MCP service path has no trusted staff session proof and fails closed
-- for managed staff. Unmanaged callers preserve their previous checks.
CREATE OR REPLACE FUNCTION private.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
begin
  perform private.staff_require_actor(p_initiator_auth_user_id, p_workspace_id, null);
  -- The service role is the only grantee. Do not accept an asserted profile ID.
  select p.id into v_profile_id
  from auth.users u
  join public.profiles p on p.auth_user_id = u.id
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where u.id = p_initiator_auth_user_id and p.active and m.active and w.active
    and m.workspace_id = p_workspace_id and m.role = 'ADMIN'
    and (coalesce(u.is_anonymous, false) is false or w.kind = 'DEMO');
  if v_profile_id is null then
    raise exception 'PROPOSAL_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  return private.workspace_assignment_proposal_insert(
    p_workspace_id, p_order_id, p_technician_id, p_expected_updated_at,
    p_scheduled_at, p_idempotency_key, v_profile_id, 'MCP'
  );
end;
$$;

-- Remove the legacy service-only signature so it cannot bypass staff proof.
drop function public.workspace_assignment_proposal_approve(uuid,uuid,uuid);
drop function private.workspace_assignment_proposal_approve(uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION private.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid DEFAULT NULL) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_approver_profile_id uuid;
  v_proposal public.workspace_assignment_proposals;
  v_generation bigint;
  v_order public.workspace_orders;
  v_stale_reason text;
begin
  perform private.staff_require_actor(p_approver_auth_user_id, p_workspace_id, p_actor_session_id);
  select p.id into v_approver_profile_id
  from public.profiles p
  join auth.users u on u.id = p.auth_user_id
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = p_approver_auth_user_id and p.active
    and m.workspace_id = p_workspace_id and m.active and m.role = 'ADMIN'
    and w.active and (not u.is_anonymous or w.kind = 'DEMO');
  if v_approver_profile_id is null then
    raise exception 'PROPOSAL_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;
  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null then
    raise exception 'PROPOSAL_WORKSPACE_UNAVAILABLE' using errcode = '42501';
  end if;
  perform 1 from public.workspace_memberships m
  join public.profiles p on p.id = m.profile_id
  where m.workspace_id = p_workspace_id and m.profile_id = v_approver_profile_id
    and m.active and m.role = 'ADMIN' and p.active
    and p.auth_user_id = p_approver_auth_user_id
    for share of m, p;
  if not found then
    raise exception 'PROPOSAL_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_proposal from public.workspace_assignment_proposals
  where workspace_id = p_workspace_id and id = p_proposal_id for update;
  if v_proposal.id is null or v_proposal.status <> 'PENDING' then
    raise exception 'PROPOSAL_NOT_PENDING' using errcode = 'P0001';
  end if;
  if v_proposal.expires_at <= clock_timestamp() then
    update public.workspace_assignment_proposals set status = 'EXPIRED'
    where workspace_id = p_workspace_id and id = p_proposal_id
    returning * into v_proposal;
    insert into public.workspace_assignment_proposal_audit (
      workspace_id, proposal_id, initiator_profile_id, approver_profile_id,
      event_type, source_client, target_order_id, outcome
    ) values (
      p_workspace_id, p_proposal_id, v_proposal.initiated_by_profile_id,
      v_approver_profile_id, 'EXPIRED', 'WEB', v_proposal.target_order_id,
      'EXPIRED_BEFORE_APPROVAL'
    );
    return v_proposal;
  end if;
  if v_generation <> v_proposal.dataset_generation then
    v_stale_reason := 'GENERATION_CHANGED_BEFORE_APPROVAL';
  else
    select * into v_order from public.workspace_orders
    where workspace_id = p_workspace_id and id = v_proposal.target_order_id
    for share;
    if v_order.id is null or v_order.updated_at <> v_proposal.target_updated_at
       or v_order.status not in ('NEW', 'ASSIGNED') then
      v_stale_reason := 'TARGET_CHANGED_BEFORE_APPROVAL';
    end if;
  end if;
  if v_stale_reason is not null then
    update public.workspace_assignment_proposals set status = 'STALE'
    where workspace_id = p_workspace_id and id = p_proposal_id
    returning * into v_proposal;
    insert into public.workspace_assignment_proposal_audit (
      workspace_id, proposal_id, initiator_profile_id, approver_profile_id,
      event_type, source_client, target_order_id, outcome
    ) values (
      p_workspace_id, p_proposal_id, v_proposal.initiated_by_profile_id,
      v_approver_profile_id, 'STALE', 'WEB', v_proposal.target_order_id,
      v_stale_reason
    );
    return v_proposal;
  end if;
  update public.workspace_assignment_proposals
  set status = 'APPROVED', approver_profile_id = v_approver_profile_id,
      approval_channel = 'WEB', approved_at = clock_timestamp()
  where workspace_id = p_workspace_id and id = p_proposal_id
  returning * into v_proposal;
  insert into public.workspace_assignment_proposal_audit (
    workspace_id, proposal_id, initiator_profile_id, approver_profile_id,
    event_type, source_client, target_order_id, outcome
  ) values (
    p_workspace_id, p_proposal_id, v_proposal.initiated_by_profile_id,
    v_approver_profile_id, 'APPROVED', 'WEB', v_proposal.target_order_id, 'APPROVED'
  );
  return v_proposal;
end;
$$;
CREATE OR REPLACE FUNCTION public.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid DEFAULT NULL) RETURNS public.workspace_assignment_proposals
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_assignment_proposal_approve(
    p_workspace_id, p_proposal_id, p_approver_auth_user_id, p_actor_session_id
  );
$$;
revoke all on function private.workspace_assignment_proposal_approve(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.workspace_assignment_proposal_approve(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.workspace_assignment_proposal_approve(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.workspace_assignment_proposal_approve(uuid,uuid,uuid,uuid) to service_role;

-- Remove the legacy service-only signature so it cannot bypass staff proof.
drop function public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[]);
drop function private.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[]);
CREATE OR REPLACE FUNCTION private.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_token uuid; v_count integer; v_i integer;
begin
  perform private.staff_require_actor(p_actor_auth_user_id, p_workspace_id, p_actor_session_id);
  if p_actor_auth_user_id is null or p_workspace_id is null or
     p_document_id is null or p_generation is null or p_generation < 1 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_count := coalesce(array_length(p_pages, 1), 0);
  if v_count not between 1 and 12 or
     char_length(array_to_string(p_pages, E'\f')) not between 1 and 100000 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_pages[v_i] is null or char_length(p_pages[v_i]) > 100000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  -- A stale or unrelated actor/document must not receive a usable claim.
  if not exists (
    select 1 from public.knowledge_documents d
    join public.workspaces w on w.id = d.workspace_id
    join public.workspace_memberships m
      on m.workspace_id = d.workspace_id and m.profile_id = d.created_by_profile_id
    join public.profiles p on p.id = m.profile_id
    join auth.users u on u.id = p.auth_user_id
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED'
      and w.active and w.generation = p_generation
      and m.active and m.role in ('ADMIN', 'MANAGER')
      and p.active and p.auth_user_id = p_actor_auth_user_id
      and not u.is_anonymous
  ) then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  delete from private.knowledge_pdf_stage_attestations
    where expires_at <= clock_timestamp();
  insert into private.knowledge_pdf_stage_attestations
    (actor_auth_user_id, workspace_id, generation, document_id, pages_sha256, expires_at)
  values (p_actor_auth_user_id, p_workspace_id, p_generation, p_document_id,
    encode(extensions.digest(convert_to(to_jsonb(p_pages)::text, 'UTF8'), 'sha256'), 'hex'),
    clock_timestamp() + interval '2 minutes')
  returning token into v_token;
  return v_token;
end;
$$;
CREATE OR REPLACE FUNCTION public.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid DEFAULT NULL) RETURNS uuid
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.knowledge_issue_pdf_attestation(
    p_actor_auth_user_id, p_workspace_id, p_generation, p_document_id, p_pages, p_actor_session_id);
$$;
revoke all on function private.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[],uuid) from public, anon, authenticated;
revoke all on function public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[],uuid) from public, anon, authenticated;
grant execute on function private.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[],uuid) to service_role;
grant execute on function public.knowledge_issue_pdf_attestation(uuid,uuid,bigint,uuid,text[],uuid) to service_role;
