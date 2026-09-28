-- Demo-only reset. The workspace row update is the transaction's serialization
-- point: all generation-aware order, proposal, and knowledge writes hold a
-- shared lock on that row. A failed delete rolls the generation back too.
-- Keep admission counters, platform configuration, Owner records and old
-- assessment tables untouched.

-- Provisioning and persona changes must join the same reset boundary. A stale
-- Auth session may survive reset, but its profile and membership will not.
create or replace function private.demo_provision_user(p_auth_user_id uuid, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace_id uuid; v_profile_id uuid;
begin
  if p_role is null or p_role not in ('ADMIN', 'MANAGER', 'TECHNICIAN')
     or not exists (select 1 from auth.users where id = p_auth_user_id and is_anonymous) then
    raise exception 'DEMO_PROVISION_FORBIDDEN' using errcode = '42501';
  end if;
  select id into v_workspace_id from public.workspaces
  where kind = 'DEMO' and active for share;
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

create or replace function private.demo_select_persona(p_role public.app_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := (select auth.uid()); v_workspace_id uuid; v_profile_id uuid;
begin
  if p_role is null or p_role not in ('ADMIN', 'MANAGER', 'TECHNICIAN')
     or v_user_id is null
     or (select (auth.jwt()->>'is_anonymous')::boolean) is not true
     or not exists (select 1 from auth.users where id = v_user_id and is_anonymous) then
    raise exception 'DEMO_PERSONA_FORBIDDEN' using errcode = '42501';
  end if;
  select id into v_workspace_id from public.workspaces
  where kind = 'DEMO' and active for share;
  if v_workspace_id is null then raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001'; end if;
  select p.id into v_profile_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  where p.auth_user_id = v_user_id and p.active and p.platform_role = 'USER'
    and m.workspace_id = v_workspace_id and m.active;
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

create function private.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_generation bigint;
  v_visitor_profile_ids uuid[];
  v_actor_profile_id uuid;
  v_staff_profile_id uuid;
begin
  -- This RPC is service-role-only. Recheck the human actor in the database;
  -- neither a browser-supplied workspace nor an anonymous caller is trusted.
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
  -- A permanent user's Demo membership is access configuration, not a
  -- disposable visitor session. Only anonymous visitors lose membership.
  delete from public.workspace_memberships
  where workspace_id = v_workspace_id
    and profile_id = any(coalesce(v_visitor_profile_ids, '{}'::uuid[]));
  -- Keep anonymous Auth/profile IDs for any old audit foreign keys. They lose
  -- membership and are deactivated; old sessions cannot provision or act.
  update public.profiles p set active = false, updated_at = now()
  where p.id = any(coalesce(v_visitor_profile_ids, '{}'::uuid[]))
    and p.platform_role = 'USER';

  insert into public.workspace_branches (workspace_id, code, name, address)
  values (v_workspace_id, 'DEMO-HQ', 'Demo Service Hub', 'Fictional service area');
  -- Permanent Demo staff keep their membership and receive a fresh mapping
  -- to the newly seeded fictional branch. Old jobs and branch IDs are gone.
  for v_staff_profile_id in
    select m.profile_id from public.workspace_memberships m
    join public.profiles p on p.id = m.profile_id
    join auth.users u on u.id = p.auth_user_id
    where m.workspace_id = v_workspace_id and m.active and p.active
      and m.role = 'TECHNICIAN' and not u.is_anonymous
  loop
    perform private.demo_ensure_technician(v_workspace_id, v_staff_profile_id);
  end loop;
  return v_generation;
end;
$$;

create function public.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint)
returns bigint language sql security invoker set search_path = '' as $$
  select private.demo_reset(p_actor_auth_user_id, p_expected_generation);
$$;
revoke execute on function private.demo_reset(uuid,bigint) from public, anon, authenticated;
revoke execute on function public.demo_reset(uuid,bigint) from public, anon, authenticated;
grant execute on function private.demo_reset(uuid,bigint) to service_role;
grant execute on function public.demo_reset(uuid,bigint) to service_role;
