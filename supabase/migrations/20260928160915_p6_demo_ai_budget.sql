-- Reserve a Demo model call before contacting a provider. All counters are
-- persistent and shared across anonymous identities, app instances, and IPs.
create table private.demo_ai_policy (
  singleton boolean primary key default true check (singleton),
  global_daily_limit integer not null check (global_daily_limit between 1 and 100000),
  ip_daily_limit integer not null check (ip_daily_limit between 1 and 10000),
  user_daily_limit integer not null check (user_daily_limit between 1 and 10000)
);
insert into private.demo_ai_policy (singleton, global_daily_limit, ip_daily_limit, user_daily_limit)
values (true, 100, 10, 5);

create table private.demo_ai_counter (
  usage_day date not null,
  scope_key text not null,
  attempt_count integer not null check (attempt_count > 0),
  primary key (usage_day, scope_key)
);
revoke all on private.demo_ai_policy, private.demo_ai_counter from public, anon, authenticated;

create function private.demo_ai_reserve(
  p_auth_user_id uuid, p_workspace_id uuid, p_ip_digest text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_global_limit integer;
  v_ip_limit integer;
  v_user_limit integer;
  v_ip_key text;
  v_user_key text;
begin
  if p_auth_user_id is null or p_workspace_id is null
     or p_ip_digest !~ '^[0-9a-f]{64}$' then return false; end if;
  if not exists (
    select 1 from auth.users u
    join public.profiles p on p.auth_user_id = u.id and p.active
    join public.workspace_memberships m on m.profile_id = p.id and m.active
    join public.workspaces w on w.id = m.workspace_id and w.active
    where u.id = p_auth_user_id and u.is_anonymous
      and p.platform_role = 'USER' and m.workspace_id = p_workspace_id
      and w.kind = 'DEMO'
  ) then return false; end if;

  v_ip_key := 'ip:' || p_ip_digest;
  v_user_key := 'user:' || p_auth_user_id::text;
  perform pg_catalog.pg_advisory_xact_lock(4402271602);
  select global_daily_limit, ip_daily_limit, user_daily_limit
    into v_global_limit, v_ip_limit, v_user_limit
  from private.demo_ai_policy where singleton;
  if v_global_limit is null then return false; end if;
  if (select attempt_count from private.demo_ai_counter
      where usage_day = v_day and scope_key = 'global') >= v_global_limit
     or (select attempt_count from private.demo_ai_counter
      where usage_day = v_day and scope_key = v_ip_key) >= v_ip_limit
     or (select attempt_count from private.demo_ai_counter
      where usage_day = v_day and scope_key = v_user_key) >= v_user_limit
  then return false; end if;
  insert into private.demo_ai_counter (usage_day, scope_key, attempt_count)
  values (v_day, 'global', 1), (v_day, v_ip_key, 1), (v_day, v_user_key, 1)
  on conflict (usage_day, scope_key) do update
    set attempt_count = private.demo_ai_counter.attempt_count + 1;
  return true;
end;
$$;

create function public.demo_ai_reserve(
  p_auth_user_id uuid, p_workspace_id uuid, p_ip_digest text
) returns boolean language sql security invoker set search_path = '' as $$
  select private.demo_ai_reserve(p_auth_user_id, p_workspace_id, p_ip_digest)
$$;
revoke execute on function private.demo_ai_reserve(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.demo_ai_reserve(uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.demo_ai_reserve(uuid,uuid,text) to service_role;
grant execute on function public.demo_ai_reserve(uuid,uuid,text) to service_role;
