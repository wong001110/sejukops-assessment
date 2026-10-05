-- MCP may prepare a proposal, but its bearer JWT cannot approve it. The
-- adapter uses a service-role-only entry point after verifying the bearer.
-- Both Web and MCP creation share the same canonical validation/insert core.

alter table public.workspace_assignment_proposal_audit
  drop constraint workspace_assignment_proposal_audit_source_client_check;
alter table public.workspace_assignment_proposal_audit
  add constraint workspace_assignment_proposal_audit_source_client_check
  check (source_client in ('WEB', 'INTERNAL_AGENT', 'MCP'));

create function private.workspace_assignment_proposal_insert(
  p_workspace_id uuid, p_order_id uuid, p_technician_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_idempotency_key uuid, p_initiator_profile_id uuid, p_source_client text
)
returns public.workspace_assignment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_generation bigint;
  v_order public.workspace_orders;
  v_payload jsonb;
  v_proposal public.workspace_assignment_proposals;
begin
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

create or replace function private.workspace_assignment_proposal_create(
  p_workspace_id uuid, p_order_id uuid, p_technician_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_idempotency_key uuid
)
returns public.workspace_assignment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := private.workspace_order_admin_profile(p_workspace_id);
  return private.workspace_assignment_proposal_insert(
    p_workspace_id, p_order_id, p_technician_id, p_expected_updated_at,
    p_scheduled_at, p_idempotency_key, v_profile_id, 'WEB'
  );
end;
$$;

create function private.workspace_assignment_proposal_create_mcp(
  p_workspace_id uuid, p_order_id uuid, p_technician_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_idempotency_key uuid, p_initiator_auth_user_id uuid
)
returns public.workspace_assignment_proposals
language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
begin
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

create function public.workspace_assignment_proposal_create_mcp(
  p_workspace_id uuid, p_order_id uuid, p_technician_id uuid,
  p_expected_updated_at timestamptz, p_scheduled_at timestamptz,
  p_idempotency_key uuid, p_initiator_auth_user_id uuid
)
returns public.workspace_assignment_proposals
language sql security invoker set search_path = '' as $$
  select private.workspace_assignment_proposal_create_mcp(
    p_workspace_id, p_order_id, p_technician_id, p_expected_updated_at,
    p_scheduled_at, p_idempotency_key, p_initiator_auth_user_id
  );
$$;

revoke all on function private.workspace_assignment_proposal_insert(
  uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text
) from public, anon, authenticated, service_role;
revoke all on function private.workspace_assignment_proposal_create_mcp(
  uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.workspace_assignment_proposal_create_mcp(
  uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid
) from public, anon, authenticated, service_role;
grant execute on function private.workspace_assignment_proposal_create_mcp(
  uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid
) to service_role;
grant execute on function public.workspace_assignment_proposal_create_mcp(
  uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid
) to service_role;
