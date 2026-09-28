-- P1 Demo entry schema and fictional branch. Public signup stays closed until
-- hosted anonymous Auth and CAPTCHA, app flags, and trusted proxy IP are
-- independently configured and verified. Direct anonymous Auth signups remain
-- subject to hosted CAPTCHA; only this flow can grant Demo membership.
-- These functions never accept metadata or a browser-selected workspace ID.

insert into public.workspace_branches (workspace_id, code, name, address)
select id, 'DEMO-HQ', 'Demo Service Hub', 'Fictional service area'
from public.workspaces where kind = 'DEMO' and active
on conflict (workspace_id, code) do nothing;

create table private.demo_entry_policy (
  singleton boolean primary key default true check (singleton),
  global_daily_limit integer not null check (global_daily_limit between 1 and 100000),
  ip_daily_limit integer not null check (ip_daily_limit between 1 and 1000)
);
insert into private.demo_entry_policy (singleton, global_daily_limit, ip_daily_limit)
values (true, 200, 5);

create table private.demo_entry_counter (
  usage_day date not null,
  scope_key text not null,
  attempt_count integer not null check (attempt_count > 0),
  primary key (usage_day, scope_key)
);
revoke all on private.demo_entry_policy, private.demo_entry_counter from public, anon, authenticated;

create function private.demo_entry_reserve(p_ip_digest text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_global_limit integer;
  v_ip_limit integer;
  v_global_count integer;
  v_ip_count integer;
  v_ip_key text;
begin
  if p_ip_digest !~ '^[0-9a-f]{64}$' then return false; end if;
  v_ip_key := 'ip:' || p_ip_digest;
  perform pg_catalog.pg_advisory_xact_lock(4402271601);
  select global_daily_limit, ip_daily_limit into v_global_limit, v_ip_limit
  from private.demo_entry_policy where singleton;
  if v_global_limit is null then return false; end if;
  select attempt_count into v_global_count from private.demo_entry_counter
  where usage_day = v_day and scope_key = 'global';
  select attempt_count into v_ip_count from private.demo_entry_counter
  where usage_day = v_day and scope_key = v_ip_key;
  if coalesce(v_global_count, 0) >= v_global_limit
     or coalesce(v_ip_count, 0) >= v_ip_limit then return false; end if;
  insert into private.demo_entry_counter (usage_day, scope_key, attempt_count)
  values (v_day, 'global', 1), (v_day, v_ip_key, 1)
  on conflict (usage_day, scope_key) do update
  set attempt_count = private.demo_entry_counter.attempt_count + 1;
  return true;
end;
$$;

create function private.demo_ensure_technician(p_workspace_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_branch_id uuid;
begin
  select id into v_branch_id from public.workspace_branches
  where workspace_id = p_workspace_id and active order by code limit 1;
  if v_branch_id is null then raise exception 'DEMO_BRANCH_UNAVAILABLE' using errcode = 'P0001'; end if;
  insert into public.workspace_technicians (workspace_id, profile_id, branch_id)
  values (p_workspace_id, p_profile_id, v_branch_id)
  on conflict (workspace_id, profile_id) do update set active = true;
end;
$$;

create function private.demo_provision_user(p_auth_user_id uuid, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid; v_profile_id uuid;
begin
  if p_role is null or p_role not in ('ADMIN', 'MANAGER', 'TECHNICIAN')
     or not exists (select 1 from auth.users where id = p_auth_user_id and is_anonymous) then
    raise exception 'DEMO_PROVISION_FORBIDDEN' using errcode = '42501';
  end if;
  select id into v_workspace_id from public.workspaces
  where kind = 'DEMO' and active;
  if v_workspace_id is null then raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles where auth_user_id = p_auth_user_id) then
    raise exception 'DEMO_ALREADY_PROVISIONED' using errcode = '23505';
  end if;
  v_profile_id := pg_catalog.gen_random_uuid();
  insert into public.profiles (id, auth_user_id, display_name, role, platform_role)
  values (v_profile_id, p_auth_user_id, 'Demo visitor', p_role, 'USER');
  insert into public.workspace_memberships (workspace_id, profile_id, role)
  values (v_workspace_id, v_profile_id, p_role);
  if p_role = 'TECHNICIAN' then
    perform private.demo_ensure_technician(v_workspace_id, v_profile_id);
  end if;
  return v_workspace_id;
end;
$$;

create function private.demo_select_persona(p_role public.app_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := (select auth.uid()); v_workspace_id uuid; v_profile_id uuid;
begin
  if p_role is null or p_role not in ('ADMIN', 'MANAGER', 'TECHNICIAN')
     or v_user_id is null
     or (select (auth.jwt()->>'is_anonymous')::boolean) is not true
     or not exists (select 1 from auth.users where id = v_user_id and is_anonymous) then
    raise exception 'DEMO_PERSONA_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id, m.workspace_id into v_profile_id, v_workspace_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = v_user_id and p.active and p.platform_role = 'USER'
    and m.active and w.active and w.kind = 'DEMO';
  if v_profile_id is null then raise exception 'DEMO_MEMBERSHIP_REQUIRED' using errcode = '42501'; end if;
  update public.profiles set role = p_role, updated_at = now() where id = v_profile_id;
  update public.workspace_memberships set role = p_role, updated_at = now()
  where workspace_id = v_workspace_id and profile_id = v_profile_id;
  if p_role = 'TECHNICIAN' then
    perform private.demo_ensure_technician(v_workspace_id, v_profile_id);
  end if;
  return v_workspace_id;
end;
$$;

create function public.demo_entry_reserve(p_ip_digest text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.demo_entry_reserve(p_ip_digest)
$$;
create function public.demo_provision_user(p_auth_user_id uuid, p_role public.app_role)
returns uuid language sql security invoker set search_path = '' as $$
  select private.demo_provision_user(p_auth_user_id, p_role)
$$;
create function public.demo_select_persona(p_role public.app_role)
returns uuid language sql security invoker set search_path = '' as $$
  select private.demo_select_persona(p_role)
$$;

revoke execute on function private.demo_entry_reserve(text) from public, anon, authenticated;
revoke execute on function private.demo_ensure_technician(uuid,uuid) from public, anon, authenticated;
revoke execute on function private.demo_provision_user(uuid,public.app_role) from public, anon, authenticated;
revoke execute on function private.demo_select_persona(public.app_role) from public, anon, authenticated;
revoke execute on function public.demo_entry_reserve(text) from public, anon, authenticated;
revoke execute on function public.demo_provision_user(uuid,public.app_role) from public, anon, authenticated;
revoke execute on function public.demo_select_persona(public.app_role) from public, anon;
grant usage on schema private to service_role, authenticated;
grant execute on function private.demo_entry_reserve(text) to service_role;
grant execute on function private.demo_ensure_technician(uuid,uuid) to service_role;
grant execute on function private.demo_provision_user(uuid,public.app_role) to service_role;
grant execute on function private.demo_select_persona(public.app_role) to authenticated;
grant execute on function public.demo_entry_reserve(text) to service_role;
grant execute on function public.demo_provision_user(uuid,public.app_role) to service_role;
grant execute on function public.demo_select_persona(public.app_role) to authenticated;
