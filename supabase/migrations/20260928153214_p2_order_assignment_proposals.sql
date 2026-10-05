-- P2 first consequential action: a human-approved assignment of an existing
-- workspace order. The application must show canonical_payload from this row
-- before its trusted web approval path calls the service-role-only approval RPC.
-- A model/tool credential has no approval grant. No client table write grants.

create type public.workspace_assignment_proposal_status as enum (
  'PENDING', 'APPROVED', 'EXECUTED', 'STALE', 'EXPIRED'
);

create table public.workspace_assignment_proposals (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  initiated_by_profile_id uuid not null,
  approver_profile_id uuid,
  executed_by_profile_id uuid,
  idempotency_key uuid not null,
  action_type text not null default 'ASSIGN_WORKSPACE_ORDER'
    check (action_type = 'ASSIGN_WORKSPACE_ORDER'),
  canonical_payload jsonb not null,
  target_order_id uuid not null,
  target_updated_at timestamptz not null,
  dataset_generation bigint not null check (dataset_generation > 0),
  expires_at timestamptz not null,
  status public.workspace_assignment_proposal_status not null default 'PENDING',
  approval_channel text check (approval_channel is null or approval_channel = 'WEB'),
  execution_source text check (execution_source is null or execution_source = 'WEB'),
  result_order_updated_at timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, initiated_by_profile_id, idempotency_key),
  -- Keep historical IDs after a Demo reset prunes orders or visitor profiles.
  -- Creation and execution validate their workspace-scoped records in SQL.
  check (jsonb_typeof(canonical_payload) = 'object'),
  check (expires_at > created_at),
  check ((status = 'PENDING' and approver_profile_id is null and approved_at is null)
      or (status <> 'PENDING' and approver_profile_id is not null and approved_at is not null)
      or (status in ('STALE', 'EXPIRED') and approver_profile_id is null)),
  check ((status = 'EXECUTED') = (executed_at is not null))
);

create index workspace_assignment_proposals_target_idx
  on public.workspace_assignment_proposals (workspace_id, target_order_id, created_at desc);

create table public.workspace_assignment_proposal_audit (
  workspace_id uuid not null,
  id uuid not null default gen_random_uuid(),
  proposal_id uuid not null,
  initiator_profile_id uuid not null,
  approver_profile_id uuid,
  executor_profile_id uuid,
  event_type text not null check (event_type in
    ('PROPOSED', 'APPROVED', 'EXECUTED', 'STALE', 'EXPIRED')),
  source_client text not null check (source_client in ('WEB', 'INTERNAL_AGENT')),
  target_order_id uuid not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, proposal_id)
    references public.workspace_assignment_proposals(workspace_id, id) on delete restrict
);

alter table public.workspace_assignment_proposals enable row level security;
alter table public.workspace_assignment_proposal_audit enable row level security;
revoke all on public.workspace_assignment_proposals from public, anon, authenticated, service_role;
revoke all on public.workspace_assignment_proposal_audit from public, anon, authenticated, service_role;
grant select on public.workspace_assignment_proposals to authenticated;
-- The service role reaches state transitions through the narrow approval RPC.
-- Direct DML would bypass the transition audit; definer functions own writes.
grant select on public.workspace_assignment_proposals to service_role;

-- Demo proposals are visitor-private drafts even though operational data is
-- shared. An approver can inspect a proposal only when explicitly recorded.
create policy workspace_assignment_proposal_read_participant
  on public.workspace_assignment_proposals for select to authenticated
  using (exists (
    select 1 from public.profiles p
    join public.workspace_memberships m on m.profile_id = p.id
    join public.workspaces w on w.id = m.workspace_id
    where p.auth_user_id = (select auth.uid()) and p.active
      and m.workspace_id = workspace_assignment_proposals.workspace_id
      and m.active and m.role = 'ADMIN' and w.active
      and (p.id = workspace_assignment_proposals.initiated_by_profile_id
        or p.id = workspace_assignment_proposals.approver_profile_id)
      and ((select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO')
  ));

-- The canonical fields cannot be altered by a status transition or a future
-- maintenance caller using service_role. State fields remain function-owned.
create function private.workspace_assignment_proposal_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.id is distinct from old.id
    or new.initiated_by_profile_id is distinct from old.initiated_by_profile_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.action_type is distinct from old.action_type
    or new.canonical_payload is distinct from old.canonical_payload
    or new.target_order_id is distinct from old.target_order_id
    or new.target_updated_at is distinct from old.target_updated_at
    or new.dataset_generation is distinct from old.dataset_generation
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at then
    raise exception 'PROPOSAL_CANONICAL_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger workspace_assignment_proposal_immutable_trigger
  before update on public.workspace_assignment_proposals
  for each row execute function private.workspace_assignment_proposal_immutable();

create function private.workspace_assignment_proposal_create(
  p_workspace_id uuid, p_order_id uuid, p_technician_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_idempotency_key uuid
)
returns public.workspace_assignment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
  v_generation bigint;
  v_order public.workspace_orders;
  v_payload jsonb;
  v_proposal public.workspace_assignment_proposals;
begin
  v_profile_id := private.workspace_order_admin_profile(p_workspace_id);
  if p_idempotency_key is null or p_expected_updated_at is null then
    raise exception 'PROPOSAL_INPUT_INVALID' using errcode = '22023';
  end if;
  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null then
    raise exception 'PROPOSAL_WORKSPACE_UNAVAILABLE' using errcode = '42501';
  end if;
  -- Serialize proposal retries for this actor without taking a global lock.
  perform 1 from public.workspace_memberships
  where workspace_id = p_workspace_id and profile_id = v_profile_id
    and active and role = 'ADMIN' for update;
  if not found then
    raise exception 'PROPOSAL_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  perform private.workspace_order_admin_profile(p_workspace_id);
  v_payload := pg_catalog.jsonb_build_object(
    'orderId', p_order_id,
    'technicianId', p_technician_id,
    'scheduledAt', p_scheduled_at
  );
  -- A retry of a completed request returns its durable result, even when the
  -- target has changed since the first request.
  select * into v_proposal from public.workspace_assignment_proposals
  where workspace_id = p_workspace_id and initiated_by_profile_id = v_profile_id
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
    p_workspace_id, v_profile_id, p_idempotency_key,
    v_payload, p_order_id, v_order.updated_at,
    v_generation, clock_timestamp() + interval '15 minutes'
  ) on conflict (workspace_id, initiated_by_profile_id, idempotency_key) do nothing
  returning * into v_proposal;

  if v_proposal.id is null then
    select * into v_proposal from public.workspace_assignment_proposals
    where workspace_id = p_workspace_id and initiated_by_profile_id = v_profile_id
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
    p_workspace_id, v_proposal.id, v_profile_id,
    'PROPOSED', 'WEB', p_order_id, 'PENDING'
  );
  return v_proposal;
end;
$$;

-- This function is reachable only through a service-role-only public wrapper.
-- The web action must resolve p_approver_auth_user_id from a fresh Auth user
-- and show canonical_payload before calling it. It is not an agent tool.
create function private.workspace_assignment_proposal_approve(
  p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid
)
returns public.workspace_assignment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_approver_profile_id uuid;
  v_proposal public.workspace_assignment_proposals;
  v_generation bigint;
  v_order public.workspace_orders;
  v_stale_reason text;
begin
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

create function private.workspace_assignment_proposal_execute(
  p_workspace_id uuid, p_proposal_id uuid
)
returns public.workspace_assignment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_executor_profile_id uuid;
  v_proposal public.workspace_assignment_proposals;
  v_generation bigint;
  v_order public.workspace_orders;
  v_result public.workspace_orders;
  v_technician_id uuid;
  v_scheduled_at timestamptz;
  v_outcome text;
begin
  v_executor_profile_id := private.workspace_order_admin_profile(p_workspace_id);
  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  -- Hold current authority stable through the assignment and audit commit.
  perform 1 from public.workspace_memberships m
  join public.profiles p on p.id = m.profile_id
  where m.workspace_id = p_workspace_id and m.profile_id = v_executor_profile_id
    and m.active and m.role = 'ADMIN' and p.active
    and p.auth_user_id = (select auth.uid())
    for share of m, p;
  if not found then
    raise exception 'PROPOSAL_EXECUTOR_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_proposal from public.workspace_assignment_proposals
  where workspace_id = p_workspace_id and id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'PROPOSAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_proposal.approver_profile_id is distinct from v_executor_profile_id then
    raise exception 'PROPOSAL_EXECUTOR_FORBIDDEN' using errcode = '42501';
  end if;
  if v_proposal.status = 'EXECUTED' then
    return v_proposal;
  end if;
  if v_proposal.status <> 'APPROVED' then
    raise exception 'PROPOSAL_NOT_APPROVED' using errcode = 'P0001';
  end if;

  if v_generation is distinct from v_proposal.dataset_generation then
    v_outcome := 'GENERATION_CHANGED';
  elsif v_proposal.expires_at <= clock_timestamp() then
    v_outcome := 'EXPIRED';
  else
    select * into v_order from public.workspace_orders
    where workspace_id = p_workspace_id and id = v_proposal.target_order_id
    for update;
    if v_order.id is null or v_order.updated_at <> v_proposal.target_updated_at
      or v_order.status not in ('NEW', 'ASSIGNED') then
      v_outcome := 'TARGET_CHANGED';
    elsif v_proposal.canonical_payload->>'orderId' <> v_order.id::text then
      v_outcome := 'PAYLOAD_MISMATCH';
    else
      v_technician_id := (v_proposal.canonical_payload->>'technicianId')::uuid;
      v_scheduled_at := (v_proposal.canonical_payload->>'scheduledAt')::timestamptz;
      if not exists (
        select 1 from public.workspace_technicians t
        join public.workspace_memberships m
          on m.workspace_id = t.workspace_id and m.profile_id = t.profile_id
        join public.profiles p on p.id = t.profile_id
        where t.workspace_id = p_workspace_id and t.id = v_technician_id
          and t.branch_id = v_order.branch_id and t.active
          and m.active and m.role = 'TECHNICIAN' and p.active
        for share of t, m, p
      ) then
        v_outcome := 'TECHNICIAN_UNAVAILABLE';
      end if;
    end if;
  end if;

  if v_outcome is not null then
    update public.workspace_assignment_proposals
    set status = case when v_outcome = 'EXPIRED'
        then 'EXPIRED'::public.workspace_assignment_proposal_status
        else 'STALE'::public.workspace_assignment_proposal_status end
    where workspace_id = p_workspace_id and id = p_proposal_id
    returning * into v_proposal;
    insert into public.workspace_assignment_proposal_audit (
      workspace_id, proposal_id, initiator_profile_id, approver_profile_id,
      executor_profile_id, event_type, source_client, target_order_id, outcome
    ) values (
      p_workspace_id, p_proposal_id, v_proposal.initiated_by_profile_id,
      v_proposal.approver_profile_id, v_executor_profile_id,
      case when v_outcome = 'EXPIRED' then 'EXPIRED' else 'STALE' end,
      'WEB', v_proposal.target_order_id, v_outcome
    );
    return v_proposal;
  end if;

  -- Reuse the manual assignment's authorization/availability/domain mutation.
  -- Its UPDATE, proposal transition, and audit insert share one DB transaction.
  v_result := private.workspace_order_assign(
    p_workspace_id, v_proposal.target_order_id, v_technician_id,
    v_proposal.target_updated_at, v_scheduled_at
  );
  update public.workspace_assignment_proposals
  set status = 'EXECUTED', executed_by_profile_id = v_executor_profile_id,
      execution_source = 'WEB', executed_at = clock_timestamp(),
      result_order_updated_at = v_result.updated_at
  where workspace_id = p_workspace_id and id = p_proposal_id
  returning * into v_proposal;
  insert into public.workspace_assignment_proposal_audit (
    workspace_id, proposal_id, initiator_profile_id, approver_profile_id,
    executor_profile_id, event_type, source_client, target_order_id, outcome
  ) values (
    p_workspace_id, p_proposal_id, v_proposal.initiated_by_profile_id,
    v_proposal.approver_profile_id, v_executor_profile_id,
    'EXECUTED', 'WEB', v_proposal.target_order_id, 'ASSIGNED'
  );
  return v_proposal;
end;
$$;

create function public.workspace_assignment_proposal_create(
  p_workspace_id uuid, p_order_id uuid, p_technician_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_idempotency_key uuid
)
returns public.workspace_assignment_proposals
language sql security invoker set search_path = '' as $$
  select private.workspace_assignment_proposal_create(
    p_workspace_id, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at, p_idempotency_key
  );
$$;

create function public.workspace_assignment_proposal_approve(
  p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid
)
returns public.workspace_assignment_proposals
language sql security invoker set search_path = '' as $$
  select private.workspace_assignment_proposal_approve(
    p_workspace_id, p_proposal_id, p_approver_auth_user_id
  );
$$;

create function public.workspace_assignment_proposal_execute(
  p_workspace_id uuid, p_proposal_id uuid
)
returns public.workspace_assignment_proposals
language sql security invoker set search_path = '' as $$
  select private.workspace_assignment_proposal_execute(p_workspace_id, p_proposal_id);
$$;

revoke execute on function private.workspace_assignment_proposal_immutable() from public, anon, authenticated;
revoke execute on function private.workspace_assignment_proposal_create(uuid,uuid,uuid,timestamptz,timestamptz,uuid) from public, anon;
revoke execute on function private.workspace_assignment_proposal_approve(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function private.workspace_assignment_proposal_execute(uuid,uuid) from public, anon;
revoke execute on function public.workspace_assignment_proposal_create(uuid,uuid,uuid,timestamptz,timestamptz,uuid) from public, anon;
revoke execute on function public.workspace_assignment_proposal_approve(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.workspace_assignment_proposal_execute(uuid,uuid) from public, anon;
grant execute on function private.workspace_assignment_proposal_create(uuid,uuid,uuid,timestamptz,timestamptz,uuid) to authenticated;
grant execute on function private.workspace_assignment_proposal_approve(uuid,uuid,uuid) to service_role;
grant execute on function private.workspace_assignment_proposal_execute(uuid,uuid) to authenticated;
grant execute on function public.workspace_assignment_proposal_create(uuid,uuid,uuid,timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.workspace_assignment_proposal_approve(uuid,uuid,uuid) to service_role;
grant execute on function public.workspace_assignment_proposal_execute(uuid,uuid) to authenticated;
