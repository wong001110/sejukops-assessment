-- Fixed Demo principals are server adapters, never independent visitors.
-- The old helper is also used by proposal create/execute and intake, so
-- denying those principals here closes their direct authenticated RPC path.
create or replace function private.workspace_order_admin_profile(p_workspace_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid;
begin
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

-- Separate from status audit: CREATE has no previous order status, while
-- ASSIGN can change technician and schedule without changing status.
-- No order/visit FK: Demo reset and visit pruning may delete those records.
create table private.workspace_order_manual_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  workspace_generation bigint not null check (workspace_generation > 0),
  order_id uuid not null,
  actor_profile_id uuid not null,
  guest_visit_id uuid,
  source text not null check (source in ('ACCOUNT', 'GUEST')),
  event_type text not null check (event_type in ('CREATE', 'ASSIGN')),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint workspace_order_manual_audit_source check (
    (source = 'GUEST' and guest_visit_id is not null)
    or (source = 'ACCOUNT' and guest_visit_id is null)
  )
);
create index workspace_order_manual_audit_scope_time_idx
  on private.workspace_order_manual_audit (workspace_id, workspace_generation, occurred_at desc);
revoke all on private.workspace_order_manual_audit from public, anon, authenticated, service_role;

-- Lock the workspace against reset and the visit against revocation while
-- checking the authenticated principal and the current persona.
create function private.workspace_order_manual_actor(
  p_workspace_id uuid, p_expected_generation bigint,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_kind public.workspace_kind;
  v_generation bigint;
begin
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

create function private.workspace_order_manual_create(
  p_workspace_id uuid, p_expected_generation bigint, p_order_no text,
  p_branch_id uuid, p_customer_id uuid, p_problem_description text,
  p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; v_order public.workspace_orders;
begin
  v_profile_id := private.workspace_order_manual_actor(
    p_workspace_id, p_expected_generation, p_guest_visit_id, p_guest_token_hash);
  if p_order_no is null or char_length(btrim(p_order_no)) not between 1 and 80
    or p_problem_description is null
    or char_length(btrim(p_problem_description)) not between 1 and 4000
    or p_service_type is null
    or char_length(btrim(p_service_type)) not between 1 and 120 then
    raise exception 'WORKSPACE_ORDER_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_branches b
    where b.workspace_id = p_workspace_id and b.id = p_branch_id and b.active
  ) or not exists (
    select 1 from public.workspace_customers c
    where c.workspace_id = p_workspace_id and c.id = p_customer_id
  ) then
    raise exception 'WORKSPACE_ORDER_REFERENCE_INVALID' using errcode = '23503';
  end if;
  insert into public.workspace_orders (
    workspace_id, order_no, branch_id, customer_id,
    problem_description, service_type, created_by_profile_id
  ) values (
    p_workspace_id, btrim(p_order_no), p_branch_id, p_customer_id,
    btrim(p_problem_description), btrim(p_service_type), v_profile_id
  ) returning * into v_order;
  insert into private.workspace_order_manual_audit (
    workspace_id, workspace_generation, order_id, actor_profile_id,
    guest_visit_id, source, event_type
  ) values (
    p_workspace_id, p_expected_generation, v_order.id, v_profile_id,
    p_guest_visit_id, case when p_guest_visit_id is null then 'ACCOUNT' else 'GUEST' end,
    'CREATE'
  );
  return v_order;
end;
$$;

create function private.workspace_order_manual_assign(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_technician_id uuid, p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz, p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; v_order public.workspace_orders;
begin
  v_profile_id := private.workspace_order_manual_actor(
    p_workspace_id, p_expected_generation, p_guest_visit_id, p_guest_token_hash);
  if not exists (
    select 1 from public.workspace_technicians t
    join public.workspace_memberships m
      on m.workspace_id = t.workspace_id and m.profile_id = t.profile_id
    join public.profiles p on p.id = t.profile_id
    where t.workspace_id = p_workspace_id and t.id = p_technician_id
      and t.active and m.active and m.role = 'TECHNICIAN' and p.active
  ) then
    raise exception 'WORKSPACE_TECHNICIAN_INVALID' using errcode = '23503';
  end if;
  update public.workspace_orders o
  set assigned_technician_id = p_technician_id,
      scheduled_at = p_scheduled_at, status = 'ASSIGNED',
      updated_at = greatest(clock_timestamp(), o.updated_at + interval '1 microsecond')
  where o.workspace_id = p_workspace_id and o.id = p_order_id
    and o.updated_at = p_expected_updated_at and o.status in ('NEW', 'ASSIGNED')
  returning * into v_order;
  if v_order.id is null then
    raise exception 'WORKSPACE_ORDER_STALE_OR_UNAVAILABLE' using errcode = 'P0001';
  end if;
  insert into private.workspace_order_manual_audit (
    workspace_id, workspace_generation, order_id, actor_profile_id,
    guest_visit_id, source, event_type
  ) values (
    p_workspace_id, p_expected_generation, v_order.id, v_profile_id,
    p_guest_visit_id, case when p_guest_visit_id is null then 'ACCOUNT' else 'GUEST' end,
    'ASSIGN'
  );
  return v_order;
end;
$$;

create function private.workspace_order_manual_create_with_customer(
  p_workspace_id uuid, p_expected_generation bigint, p_order_no text,
  p_branch_id uuid, p_customer_name text, p_customer_phone text,
  p_customer_address text, p_problem_description text, p_service_type text,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
declare v_customer_id uuid;
begin
  -- Authorize before inserting a customer. The subsequent create rechecks
  -- visit and generation; all three writes roll back together on failure.
  perform private.workspace_order_manual_actor(
    p_workspace_id, p_expected_generation, p_guest_visit_id, p_guest_token_hash);
  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 1 and 160
    or p_customer_address is null or char_length(btrim(p_customer_address)) not between 1 and 800
    or (p_customer_phone is not null and
      (char_length(p_customer_phone) > 40 or p_customer_phone !~ '^\+?[0-9][0-9 -]{6,20}$')) then
    raise exception 'WORKSPACE_CUSTOMER_INPUT_INVALID' using errcode = '22023';
  end if;
  insert into public.workspace_customers (workspace_id, name, phone, address)
  values (p_workspace_id, btrim(p_customer_name), nullif(btrim(p_customer_phone), ''),
    btrim(p_customer_address)) returning id into v_customer_id;
  return private.workspace_order_manual_create(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    v_customer_id, p_problem_description, p_service_type,
    p_guest_visit_id, p_guest_token_hash);
end;
$$;

-- Preserve existing function dependencies while removing every client grant
-- from the proof-free public signatures. The revised admin helper also denies
-- fixed Demo principals through old private proposal/intake paths.
revoke execute on function public.workspace_order_create(uuid,bigint,text,uuid,uuid,text,text),
  public.workspace_order_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz),
  public.workspace_order_create_with_customer(uuid,bigint,text,uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function private.workspace_order_create_current(uuid,bigint,text,uuid,uuid,text,text) from authenticated;
revoke execute on function private.workspace_order_assign_current(uuid,bigint,uuid,uuid,timestamptz,timestamptz) from authenticated;
revoke execute on function private.workspace_order_create_with_customer(uuid,bigint,text,uuid,text,text,text,text,text) from authenticated;

create function public.workspace_order_create(
  p_workspace_id uuid, p_expected_generation bigint, p_order_no text,
  p_branch_id uuid, p_customer_id uuid, p_problem_description text,
  p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_manual_create(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_id, p_problem_description, p_service_type,
    p_guest_visit_id, p_guest_token_hash);
$$;
create function public.workspace_order_assign(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_technician_id uuid, p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz, p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_manual_assign(
    p_workspace_id, p_expected_generation, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at, p_guest_visit_id, p_guest_token_hash);
$$;
create function public.workspace_order_create_with_customer(
  p_workspace_id uuid, p_expected_generation bigint, p_order_no text,
  p_branch_id uuid, p_customer_name text, p_customer_phone text,
  p_customer_address text, p_problem_description text, p_service_type text,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_manual_create_with_customer(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_name, p_customer_phone, p_customer_address,
    p_problem_description, p_service_type, p_guest_visit_id, p_guest_token_hash);
$$;

revoke execute on function private.workspace_order_manual_actor(uuid,bigint,uuid,text),
  private.workspace_order_manual_create(uuid,bigint,text,uuid,uuid,text,text,uuid,text),
  private.workspace_order_manual_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz,uuid,text),
  private.workspace_order_manual_create_with_customer(uuid,bigint,text,uuid,text,text,text,text,text,uuid,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.workspace_order_create(uuid,bigint,text,uuid,uuid,text,text,uuid,text),
  public.workspace_order_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz,uuid,text),
  public.workspace_order_create_with_customer(uuid,bigint,text,uuid,text,text,text,text,text,uuid,text)
  from public, anon;
grant execute on function private.workspace_order_manual_create(uuid,bigint,text,uuid,uuid,text,text,uuid,text),
  private.workspace_order_manual_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz,uuid,text),
  private.workspace_order_manual_create_with_customer(uuid,bigint,text,uuid,text,text,text,text,text,uuid,text)
  to authenticated;
grant execute on function public.workspace_order_create(uuid,bigint,text,uuid,uuid,text,text,uuid,text),
  public.workspace_order_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz,uuid,text),
  public.workspace_order_create_with_customer(uuid,bigint,text,uuid,text,text,text,text,text,uuid,text)
  to authenticated;
