-- A workspace Manager may change the schedule of an assigned order without
-- changing its technician. The audit survives Demo reset and Guest visit expiry.
create table private.workspace_order_schedule_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  workspace_generation bigint not null check (workspace_generation > 0),
  order_id uuid not null,
  actor_profile_id uuid not null,
  guest_visit_id uuid,
  source text not null check (source in ('ACCOUNT', 'GUEST')),
  from_scheduled_at timestamptz,
  to_scheduled_at timestamptz not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint workspace_order_schedule_audit_guest_source check (
    (source = 'GUEST' and guest_visit_id is not null)
    or (source = 'ACCOUNT' and guest_visit_id is null)
  )
);
create index workspace_order_schedule_audit_scope_time_idx
  on private.workspace_order_schedule_audit (workspace_id, workspace_generation, occurred_at desc);
revoke all on private.workspace_order_schedule_audit from public, anon, authenticated, service_role;

create function private.workspace_order_manager_reschedule(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_workspace_kind public.workspace_kind;
  v_generation bigint;
  v_previous_schedule timestamptz;
  v_order public.workspace_orders;
begin
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

create function public.workspace_order_manager_reschedule(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_guest_visit_id uuid, p_guest_token_hash text
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_manager_reschedule(
    p_workspace_id, p_expected_generation, p_order_id,
    p_expected_updated_at, p_scheduled_at, p_guest_visit_id, p_guest_token_hash
  );
$$;

revoke execute on function private.workspace_order_manager_reschedule(uuid,bigint,uuid,timestamptz,timestamptz,uuid,text) from public, anon;
revoke execute on function public.workspace_order_manager_reschedule(uuid,bigint,uuid,timestamptz,timestamptz,uuid,text) from public, anon;
grant execute on function private.workspace_order_manager_reschedule(uuid,bigint,uuid,timestamptz,timestamptz,uuid,text) to authenticated;
grant execute on function public.workspace_order_manager_reschedule(uuid,bigint,uuid,timestamptz,timestamptz,uuid,text) to authenticated;
