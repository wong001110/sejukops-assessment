-- One persistent allowance for all Guest paid-model requests. Each outbound
-- request reserves one unit immediately before dispatch, including retries.
-- The old authenticated Demo budget stays in place until callers migrate.
create table private.guest_ai_budget_policy (
  singleton boolean primary key default true check (singleton),
  daily_limit integer not null check (daily_limit between 1 and 1000)
);
insert into private.guest_ai_budget_policy (singleton, daily_limit)
values (true, 20);

create table private.guest_ai_budget_counter (
  usage_day date primary key,
  attempt_count integer not null check (attempt_count > 0)
);

alter table private.guest_ai_budget_policy enable row level security;
alter table private.guest_ai_budget_counter enable row level security;
revoke all on private.guest_ai_budget_policy, private.guest_ai_budget_counter
  from public, anon, authenticated;

-- The service-only wrapper receives a server-resolved visit ID. It rechecks
-- that persisted visit after the quota lock, so a forged, expired, revoked or
-- reset-invalidated visit never consumes a paid-model unit.
create function private.guest_ai_budget_reserve(
  p_visit_id uuid, p_workspace_id uuid, p_generation bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date;
  v_reset_at timestamptz;
  v_limit integer;
  v_used integer;
  v_allowed boolean := false;
begin
  if p_visit_id is null or p_workspace_id is null or p_generation is null then
    raise exception 'Guest AI scope is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(4402271611);
  perform 1 from public.guest_visits v
    join public.workspaces w on w.id = v.workspace_id
    where v.id = p_visit_id and v.workspace_id = p_workspace_id
      and v.demo_generation = p_generation and v.revoked_at is null
      and v.expires_at > pg_catalog.clock_timestamp()
      and w.kind = 'DEMO' and w.active and w.generation = p_generation
    for share of v, w;
  if not found then
    raise exception 'Guest AI visit is stale or unavailable' using errcode = '42501';
  end if;
  -- Derive the day after waiting for locks, so a midnight waiter cannot
  -- reserve a unit against yesterday's counter.
  v_day := (pg_catalog.clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_reset_at := (v_day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  select p.daily_limit into v_limit
    from private.guest_ai_budget_policy p where p.singleton;
  if v_limit is null then
    raise exception 'Guest AI policy is unavailable' using errcode = '55000';
  end if;
  select coalesce(c.attempt_count, 0) into v_used
    from private.guest_ai_budget_counter c where c.usage_day = v_day;
  v_used := coalesce(v_used, 0);
  if v_used < v_limit then
    insert into private.guest_ai_budget_counter (usage_day, attempt_count)
      values (v_day, 1)
      on conflict (usage_day) do update
        set attempt_count = private.guest_ai_budget_counter.attempt_count + 1
      returning attempt_count into v_used;
    v_allowed := true;
  end if;
  return pg_catalog.jsonb_build_object(
    'allowed', v_allowed, 'used', v_used, 'limit', v_limit,
    'remaining', greatest(0, v_limit - v_used), 'resetAt', v_reset_at
  );
end;
$$;

create function private.guest_ai_budget_status(
  p_visit_id uuid, p_workspace_id uuid, p_generation bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (pg_catalog.clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_limit integer;
  v_used integer;
begin
  if p_visit_id is null or p_workspace_id is null or p_generation is null then
    raise exception 'Guest AI scope is required' using errcode = '22023';
  end if;
  perform 1 from public.guest_visits v
    join public.workspaces w on w.id = v.workspace_id
    where v.id = p_visit_id and v.workspace_id = p_workspace_id
      and v.demo_generation = p_generation and v.revoked_at is null
      and v.expires_at > pg_catalog.clock_timestamp()
      and w.kind = 'DEMO' and w.active and w.generation = p_generation;
  if not found then
    raise exception 'Guest AI visit is stale or unavailable' using errcode = '42501';
  end if;
  select p.daily_limit into v_limit
    from private.guest_ai_budget_policy p where p.singleton;
  if v_limit is null then
    raise exception 'Guest AI policy is unavailable' using errcode = '55000';
  end if;
  select coalesce(c.attempt_count, 0) into v_used
    from private.guest_ai_budget_counter c where c.usage_day = v_day;
  v_used := coalesce(v_used, 0);
  return pg_catalog.jsonb_build_object(
    'used', v_used, 'limit', v_limit,
    'remaining', greatest(0, v_limit - v_used),
    'resetAt', (v_day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
  );
end;
$$;

-- Separate Owner read path: no Guest visit is required, but the permanent
-- platform actor is rechecked in SQL because the RPC uses service_role.
create function private.guest_ai_budget_status_admin(p_actor_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (pg_catalog.clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_limit integer;
  v_used integer;
begin
  if not exists (
    select 1 from auth.users u
    join public.profiles p on p.auth_user_id = u.id
    where u.id = p_actor_auth_user_id and u.is_anonymous is false
      and p.active and p.platform_role = 'SUPER_ADMIN'
  ) then
    raise exception 'Platform Super Admin is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces w
    where w.kind = 'DEMO' and w.active) then
    raise exception 'Demo workspace is unavailable' using errcode = '55000';
  end if;
  select p.daily_limit into v_limit
    from private.guest_ai_budget_policy p where p.singleton;
  if v_limit is null then
    raise exception 'Guest AI policy is unavailable' using errcode = '55000';
  end if;
  select coalesce(c.attempt_count, 0) into v_used
    from private.guest_ai_budget_counter c where c.usage_day = v_day;
  v_used := coalesce(v_used, 0);
  return pg_catalog.jsonb_build_object(
    'used', v_used, 'limit', v_limit,
    'remaining', greatest(0, v_limit - v_used),
    'resetAt', (v_day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
  );
end;
$$;

-- Service role alone cannot identify the initiating Owner. Require the
-- caller's freshly resolved platform actor and verify it again in SQL.
create function private.guest_ai_budget_set_limit(
  p_actor_auth_user_id uuid, p_daily_limit integer
) returns integer language plpgsql security definer set search_path = '' as $$
begin
  if p_daily_limit is null or p_daily_limit not between 1 and 1000 then
    raise exception 'Guest AI daily limit must be between 1 and 1000'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users u
    join public.profiles p on p.auth_user_id = u.id
    where u.id = p_actor_auth_user_id and u.is_anonymous is false
      and p.active and p.platform_role = 'SUPER_ADMIN'
  ) then
    raise exception 'Platform Super Admin is required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(4402271611);
  update private.guest_ai_budget_policy set daily_limit = p_daily_limit
    where singleton;
  if not found then
    raise exception 'Guest AI policy is unavailable' using errcode = '55000';
  end if;
  return p_daily_limit;
end;
$$;

create function public.guest_ai_budget_reserve(
  p_visit_id uuid, p_workspace_id uuid, p_generation bigint
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.guest_ai_budget_reserve(p_visit_id, p_workspace_id, p_generation)
$$;
create function public.guest_ai_budget_status(
  p_visit_id uuid, p_workspace_id uuid, p_generation bigint
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.guest_ai_budget_status(p_visit_id, p_workspace_id, p_generation)
$$;
create function public.guest_ai_budget_status_admin(p_actor_auth_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.guest_ai_budget_status_admin(p_actor_auth_user_id)
$$;
create function public.guest_ai_budget_set_limit(
  p_actor_auth_user_id uuid, p_daily_limit integer
) returns integer language sql security invoker set search_path = '' as $$
  select private.guest_ai_budget_set_limit(p_actor_auth_user_id, p_daily_limit)
$$;

revoke execute on function private.guest_ai_budget_reserve(uuid,uuid,bigint),
  private.guest_ai_budget_status(uuid,uuid,bigint),
  private.guest_ai_budget_status_admin(uuid),
  private.guest_ai_budget_set_limit(uuid,integer),
  public.guest_ai_budget_reserve(uuid,uuid,bigint),
  public.guest_ai_budget_status(uuid,uuid,bigint),
  public.guest_ai_budget_status_admin(uuid),
  public.guest_ai_budget_set_limit(uuid,integer)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.guest_ai_budget_reserve(uuid,uuid,bigint),
  private.guest_ai_budget_status(uuid,uuid,bigint),
  private.guest_ai_budget_status_admin(uuid),
  private.guest_ai_budget_set_limit(uuid,integer),
  public.guest_ai_budget_reserve(uuid,uuid,bigint),
  public.guest_ai_budget_status(uuid,uuid,bigint),
  public.guest_ai_budget_status_admin(uuid),
  public.guest_ai_budget_set_limit(uuid,integer)
  to service_role;
