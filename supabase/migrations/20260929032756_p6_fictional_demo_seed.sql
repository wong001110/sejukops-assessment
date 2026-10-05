-- Fictional Demo starter records. The helper is intentionally Demo-only and
-- idempotent: it will never mix samples into an already populated workspace.
-- IDs change on reset; stable order numbers and content make the dataset
-- reproducible while invalidating stale references from the old generation.

create function private.demo_seed()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_admin_profile_id uuid;
  v_technician_id uuid;
  v_admin_count integer;
  v_technician_count integer;
begin
  -- The same row serializes reset, seed, and generation-aware writes.
  select w.id into v_workspace_id
  from public.workspaces w where w.kind = 'DEMO' and w.active for update;
  if v_workspace_id is null then
    raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- Fresh setup may not yet have the three fixed server-side principals.
  -- In that case the bootstrap calls the service-only wrapper after creating
  -- them. A later reset can seed in the same transaction.
  select count(*)::integer, (array_agg(p.id))[1]
  into v_admin_count, v_admin_profile_id
  from public.profiles p
  join auth.users u on u.id = p.auth_user_id
  join public.workspace_memberships m on m.profile_id = p.id
  where m.workspace_id = v_workspace_id and m.active and m.role = 'ADMIN'
    and p.active and p.demo_principal and p.platform_role = 'USER'
    and p.role = 'ADMIN' and not u.is_anonymous;
  select count(*)::integer, (array_agg(t.id))[1]
  into v_technician_count, v_technician_id
  from public.workspace_technicians t
  join public.workspace_memberships m
    on m.workspace_id = t.workspace_id and m.profile_id = t.profile_id
  join public.profiles p on p.id = t.profile_id
  join auth.users u on u.id = p.auth_user_id
  where t.workspace_id = v_workspace_id and t.active
    and m.active and m.role = 'TECHNICIAN'
    and p.active and p.demo_principal and p.platform_role = 'USER'
    and p.role = 'TECHNICIAN' and not u.is_anonymous;
  if v_admin_count = 0 or v_technician_count = 0 then return false; end if;
  if v_admin_count <> 1 or v_technician_count <> 1 then
    raise exception 'DEMO_PRINCIPAL_AMBIGUOUS' using errcode = 'P0001';
  end if;

  -- Existing shared Demo edits are never overwritten by migration retry.
  if exists (select 1 from public.workspace_customers where workspace_id = v_workspace_id)
     or exists (select 1 from public.workspace_orders where workspace_id = v_workspace_id) then
    return false;
  end if;
  select id into v_branch_id from public.workspace_branches
  where workspace_id = v_workspace_id and code = 'DEMO-HQ' and active;
  if v_branch_id is null then
    raise exception 'DEMO_BRANCH_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.workspace_customers (workspace_id, name, address)
  values (v_workspace_id, 'Demo Customer', 'Fictional service area')
  returning id into v_customer_id;

  insert into public.workspace_orders (
    workspace_id, order_no, branch_id, customer_id, assigned_technician_id,
    problem_description, service_type, status, scheduled_at,
    created_by_profile_id, created_at, updated_at
  ) values
    (v_workspace_id, 'DEMO-001', v_branch_id, v_customer_id, null,
     'Air conditioner is not cooling in the demonstration reception area.',
     'Air conditioner inspection', 'NEW', null,
     v_admin_profile_id, now() - interval '3 hours', now() - interval '3 hours'),
    (v_workspace_id, 'DEMO-002', v_branch_id, v_customer_id, v_technician_id,
     'Water leaks from the demonstration unit during operation.',
     'Air conditioner repair', 'ASSIGNED', now() + interval '1 day',
     v_admin_profile_id, now() - interval '2 hours', now() - interval '2 hours'),
    (v_workspace_id, 'DEMO-003', v_branch_id, v_customer_id, v_technician_id,
     'Demonstration unit requires filter cleaning and airflow check.',
     'Preventive maintenance', 'IN_PROGRESS', now() - interval '1 hour',
     v_admin_profile_id, now() - interval '1 hour', now() - interval '1 hour'),
    (v_workspace_id, 'DEMO-004', v_branch_id, v_customer_id, v_technician_id,
     'Demonstration unit was inspected and cooling was restored.',
     'Air conditioner repair', 'COMPLETED', now() - interval '2 days',
     v_admin_profile_id, now() - interval '3 days', now() - interval '2 days');
  return true;
end;
$$;

create function public.demo_seed()
returns boolean language sql security invoker set search_path = '' as $$
  select private.demo_seed();
$$;
revoke execute on function private.demo_seed(), public.demo_seed()
  from public, anon, authenticated;
grant execute on function private.demo_seed(), public.demo_seed()
  to service_role;

-- Initial installation seeds the confirmed empty Demo. When this migration
-- runs before principal bootstrap, it safely waits for the bootstrap call.
select private.demo_seed();

-- Keep the existing authorization, generation lock, deletion order, and Owner
-- boundary. Only the final Demo seed call is new.
create or replace function private.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_generation bigint;
  v_visitor_profile_ids uuid[];
  v_actor_profile_id uuid;
  v_staff_profile_id uuid;
begin
  select p.id into v_actor_profile_id
    from auth.users u
    join public.profiles p on p.auth_user_id = u.id
    where u.id = p_actor_auth_user_id and not u.is_anonymous
      and p.active and p.platform_role = 'SUPER_ADMIN'
    for share of u, p;
  if v_actor_profile_id is null then
    raise exception 'DEMO_RESET_FORBIDDEN' using errcode = '42501';
  end if;
  select id, generation into v_workspace_id, v_generation
  from public.workspaces where kind = 'DEMO' and active for update;
  if v_workspace_id is null then
    raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if p_expected_generation is null or p_expected_generation <> v_generation then
    raise exception 'WORKSPACE_GENERATION_STALE' using errcode = 'P0001';
  end if;
  update public.workspaces set generation = generation + 1, updated_at = now()
  where id = v_workspace_id returning generation into v_generation;

  select pg_catalog.array_agg(p.id) into v_visitor_profile_ids
  from public.workspace_memberships m
  join public.profiles p on p.id = m.profile_id
  join auth.users u on u.id = p.auth_user_id
  where m.workspace_id = v_workspace_id and u.is_anonymous;

  delete from public.workspace_assignment_proposal_audit where workspace_id = v_workspace_id;
  delete from public.workspace_assignment_proposals where workspace_id = v_workspace_id;
  update public.knowledge_documents
  set state = 'DRAFT', published_version_id = null
  where workspace_id = v_workspace_id and published_version_id is not null;
  delete from public.knowledge_chunks where workspace_id = v_workspace_id;
  delete from public.knowledge_versions where workspace_id = v_workspace_id;
  delete from public.knowledge_documents where workspace_id = v_workspace_id;
  delete from public.workspace_orders where workspace_id = v_workspace_id;
  delete from public.workspace_technicians where workspace_id = v_workspace_id;
  delete from public.workspace_customers where workspace_id = v_workspace_id;
  delete from public.workspace_branches where workspace_id = v_workspace_id;
  delete from public.workspace_memberships
  where workspace_id = v_workspace_id
    and profile_id = any(coalesce(v_visitor_profile_ids, '{}'::uuid[]));
  update public.profiles p set active = false, updated_at = now()
  where p.id = any(coalesce(v_visitor_profile_ids, '{}'::uuid[]))
    and p.platform_role = 'USER';

  insert into public.workspace_branches (workspace_id, code, name, address)
  values (v_workspace_id, 'DEMO-HQ', 'Demo Service Hub', 'Fictional service area');
  for v_staff_profile_id in
    select m.profile_id from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join auth.users u on u.id = p.auth_user_id
    where m.workspace_id = v_workspace_id and m.active and p.active
      and m.role = 'TECHNICIAN' and not u.is_anonymous
  loop
    perform private.demo_ensure_technician(v_workspace_id, v_staff_profile_id);
  end loop;
  perform private.demo_seed();
  return v_generation;
end;
$$;
revoke execute on function private.demo_reset(uuid,bigint)
  from public, anon, authenticated;
grant execute on function private.demo_reset(uuid,bigint) to service_role;
