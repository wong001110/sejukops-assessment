-- The public functions are invoker-only Data API adapters. Privileged writes
-- live in a non-exposed schema and independently resolve the Auth user.
-- Assignment cannot substitute a technician from another branch.
alter table public.workspace_technicians
  add constraint workspace_technicians_workspace_branch_id_key
  unique (workspace_id, branch_id, id);
alter table public.workspace_orders
  add constraint workspace_orders_assigned_same_branch_fkey
  foreign key (workspace_id, branch_id, assigned_technician_id)
  references public.workspace_technicians(workspace_id, branch_id, id)
  on delete restrict;

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.workspace_order_admin_profile(p_workspace_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'WORKSPACE_ORDER_FORBIDDEN' using errcode = '42501';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid())
    and p.active and m.active and w.active
    and m.workspace_id = p_workspace_id
    and m.role = 'ADMIN'
    and ((select (auth.jwt()->>'is_anonymous')::boolean) is false
      or w.kind = 'DEMO');

  if v_profile_id is null then
    raise exception 'WORKSPACE_ORDER_FORBIDDEN' using errcode = '42501';
  end if;
  return v_profile_id;
end;
$$;

create function private.workspace_order_create(
  p_workspace_id uuid,
  p_order_no text,
  p_branch_id uuid,
  p_customer_id uuid,
  p_problem_description text,
  p_service_type text
)
returns public.workspace_orders
language plpgsql
security definer set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_order public.workspace_orders;
begin
  v_profile_id := private.workspace_order_admin_profile(p_workspace_id);
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
  return v_order;
end;
$$;

create function private.workspace_order_assign(
  p_workspace_id uuid,
  p_order_id uuid,
  p_technician_id uuid,
  p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz
)
returns public.workspace_orders
language plpgsql
security definer set search_path = ''
as $$
declare
  v_order public.workspace_orders;
begin
  perform private.workspace_order_admin_profile(p_workspace_id);
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
      scheduled_at = p_scheduled_at,
      status = 'ASSIGNED',
      updated_at = greatest(clock_timestamp(), o.updated_at + interval '1 microsecond')
  where o.workspace_id = p_workspace_id and o.id = p_order_id
    and o.updated_at = p_expected_updated_at
    and o.status in ('NEW', 'ASSIGNED')
  returning * into v_order;

  if v_order.id is null then
    raise exception 'WORKSPACE_ORDER_STALE_OR_UNAVAILABLE' using errcode = 'P0001';
  end if;
  return v_order;
end;
$$;

create function public.workspace_order_create(
  p_workspace_id uuid,
  p_order_no text,
  p_branch_id uuid,
  p_customer_id uuid,
  p_problem_description text,
  p_service_type text
)
returns public.workspace_orders
language sql
security invoker set search_path = ''
as $$
  select private.workspace_order_create(
    p_workspace_id, p_order_no, p_branch_id, p_customer_id,
    p_problem_description, p_service_type
  );
$$;

create function public.workspace_order_assign(
  p_workspace_id uuid,
  p_order_id uuid,
  p_technician_id uuid,
  p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz
)
returns public.workspace_orders
language sql
security invoker set search_path = ''
as $$
  select private.workspace_order_assign(
    p_workspace_id, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at
  );
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Explicitly close both
-- layers and grant only authenticated execution. Table write grants stay off.
revoke execute on function private.workspace_order_admin_profile(uuid) from public, anon;
revoke execute on function private.workspace_order_create(uuid,text,uuid,uuid,text,text) from public, anon;
revoke execute on function private.workspace_order_assign(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon;
revoke execute on function public.workspace_order_create(uuid,text,uuid,uuid,text,text) from public, anon;
revoke execute on function public.workspace_order_assign(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function private.workspace_order_admin_profile(uuid) to authenticated;
grant execute on function private.workspace_order_create(uuid,text,uuid,uuid,text,text) to authenticated;
grant execute on function private.workspace_order_assign(uuid,uuid,uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.workspace_order_create(uuid,text,uuid,uuid,text,text) to authenticated;
grant execute on function public.workspace_order_assign(uuid,uuid,uuid,timestamptz,timestamptz) to authenticated;
