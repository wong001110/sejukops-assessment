-- A technician may advance only an assigned job in their own workspace.
-- The workspace row lock serializes this write with Demo reset, while the
-- exact order timestamp prevents a stale browser from overwriting newer work.
-- This audit deliberately has no order/visit foreign key: Demo reset deletes
-- orders and expired visits are pruned, while the event remains attributable
-- by workspace, generation, actor and visit ID. It contains no customer data.
create table private.workspace_order_activity_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  workspace_generation bigint not null check (workspace_generation > 0),
  order_id uuid not null,
  actor_profile_id uuid not null,
  guest_visit_id uuid,
  source text not null check (source in ('ACCOUNT', 'GUEST')),
  from_status public.service_order_status not null,
  to_status public.service_order_status not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint workspace_order_activity_guest_source check (
    (source = 'GUEST' and guest_visit_id is not null)
    or (source = 'ACCOUNT' and guest_visit_id is null)
  )
);
create index workspace_order_activity_scope_time_idx
  on private.workspace_order_activity_audit (workspace_id, workspace_generation, occurred_at desc);
revoke all on private.workspace_order_activity_audit from public, anon, authenticated, service_role;

create function private.workspace_order_technician_transition(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_expected_updated_at timestamptz, p_next_status public.service_order_status,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_persona public.app_role;
  v_workspace_kind public.workspace_kind;
  v_generation bigint;
  v_old_status public.service_order_status;
  v_order public.workspace_orders;
begin
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

create function public.workspace_order_technician_transition(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_expected_updated_at timestamptz, p_next_status public.service_order_status,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_technician_transition(
    p_workspace_id, p_expected_generation, p_order_id,
    p_expected_updated_at, p_next_status, p_guest_visit_id, p_guest_token_hash
  );
$$;

revoke execute on function private.workspace_order_technician_transition(uuid,bigint,uuid,timestamptz,public.service_order_status,uuid,text) from public, anon;
revoke execute on function public.workspace_order_technician_transition(uuid,bigint,uuid,timestamptz,public.service_order_status,uuid,text) from public, anon;
grant execute on function private.workspace_order_technician_transition(uuid,bigint,uuid,timestamptz,public.service_order_status,uuid,text) to authenticated;
grant execute on function public.workspace_order_technician_transition(uuid,bigint,uuid,timestamptz,public.service_order_status,uuid,text) to authenticated;
