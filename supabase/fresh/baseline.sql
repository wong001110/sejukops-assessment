--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- The Supabase target already supplies the public schema.


--
-- Name: ai_provider_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_provider_status AS ENUM (
    'ACTIVE',
    'DISABLED',
    'INVALID'
);


--
-- Name: ai_routing_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_routing_mode AS ENUM (
    'SINGLE_MODEL',
    'TASK_BASED'
);


--
-- Name: ai_task_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_task_type AS ENUM (
    'OPERATIONS_QUERY',
    'WORKFLOW_EXPLANATION',
    'OPERATIONAL_INSIGHT',
    'DOCUMENT_UNDERSTANDING'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'ADMIN',
    'TECHNICIAN',
    'MANAGER'
);


--
-- Name: document_extraction_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_extraction_status AS ENUM (
    'NOT_STARTED',
    'EXTRACTING',
    'EXTRACTED',
    'FAILED',
    'CONFIRMED'
);


--
-- Name: document_source_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_source_status AS ENUM (
    'RESERVED',
    'UPLOADED'
);


--
-- Name: knowledge_document_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.knowledge_document_state AS ENUM (
    'DRAFT',
    'PUBLISHED',
    'ARCHIVED'
);


--
-- Name: knowledge_index_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.knowledge_index_state AS ENUM (
    'PENDING',
    'PROCESSING',
    'READY',
    'FAILED'
);


--
-- Name: platform_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform_role AS ENUM (
    'USER',
    'SUPER_ADMIN'
);


--
-- Name: service_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_order_status AS ENUM (
    'NEW',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'CLOSED'
);


--
-- Name: workspace_assignment_proposal_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workspace_assignment_proposal_status AS ENUM (
    'PENDING',
    'APPROVED',
    'EXECUTED',
    'STALE',
    'EXPIRED'
);


--
-- Name: workspace_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workspace_kind AS ENUM (
    'DEMO',
    'OWNER'
);


--
-- Name: demo_ensure_technician(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_ensure_technician(p_workspace_id uuid, p_profile_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_branch_id uuid;
begin
  select id into v_branch_id from public.workspace_branches
  where workspace_id = p_workspace_id and active order by code limit 1;
  if v_branch_id is null then raise exception 'DEMO_BRANCH_UNAVAILABLE' using errcode = 'P0001'; end if;
  insert into public.workspace_technicians (workspace_id, profile_id, branch_id)
  values (p_workspace_id, p_profile_id, v_branch_id)
  on conflict (workspace_id, profile_id) do update set active = true;
end;
$$;


--
-- Name: demo_principal_membership_guard(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_principal_membership_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists (
    select 1 from public.profiles p
    join public.workspaces w on w.id = new.workspace_id
    where p.id = new.profile_id and p.demo_principal and w.kind = 'OWNER'
    for share of p
  ) then
    raise exception 'Demo principal cannot join Owner workspace'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: demo_principal_profile_guard(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_principal_profile_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.demo_principal and exists (
    select 1 from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.profile_id = new.id and w.kind = 'OWNER'
  ) then
    raise exception 'Demo principal cannot have Owner membership'
      using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: demo_reset(uuid, bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: demo_reset_inventory(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_reset_inventory() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select pg_catalog.jsonb_build_object(
    'workspaceId', w.id,
    'generation', w.generation,
    'branches', (select count(*) from public.workspace_branches b where b.workspace_id = w.id),
    'orders', (select count(*) from public.workspace_orders o where o.workspace_id = w.id),
    'technicians', (select count(*) from public.workspace_technicians t where t.workspace_id = w.id),
    'customers', (select count(*) from public.workspace_customers c where c.workspace_id = w.id),
    'memberships', (select count(*) from public.workspace_memberships m where m.workspace_id = w.id),
    'proposals', (select count(*) from public.workspace_assignment_proposals p where p.workspace_id = w.id),
    'proposalAudit', (select count(*) from public.workspace_assignment_proposal_audit a where a.workspace_id = w.id),
    'knowledgeDocuments', (select count(*) from public.knowledge_documents d where d.workspace_id = w.id),
    'knowledgeVersions', (select count(*) from public.knowledge_versions v where v.workspace_id = w.id),
    'knowledgeChunks', (select count(*) from public.knowledge_chunks k where k.workspace_id = w.id)
  ) from public.workspaces w where w.kind = 'DEMO' and w.active;
$$;


--
-- Name: demo_seed(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_seed() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_workspace_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_admin_profile_id uuid;
  v_technician_id uuid;
  v_admin_count integer;
  v_technician_count integer;
begin
  select w.id into v_workspace_id
  from public.workspaces w where w.kind = 'DEMO' and w.active for update;
  if v_workspace_id is null then
    raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001';
  end if;

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

  perform private.demo_seed_knowledge();
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


--
-- Name: demo_seed_knowledge(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.demo_seed_knowledge() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_workspace_id uuid;
  v_generation bigint;
  v_workspace_count integer;
  v_admin_count integer;
  v_admin_profile_id uuid;
  v_document_id uuid;
  v_version_id uuid;
  v_item record;
begin
  select count(*)::integer into v_workspace_count
  from public.workspaces w where w.kind = 'DEMO' and w.active;
  if v_workspace_count <> 1 then
    raise exception 'DEMO_UNAVAILABLE_OR_AMBIGUOUS' using errcode = 'P0001';
  end if;
  -- Serialize with Demo reset and generation-aware knowledge writes.
  select w.id, w.generation into v_workspace_id, v_generation
  from public.workspaces w where w.kind = 'DEMO' and w.active for update;
  if v_workspace_id is null or v_generation is null or v_generation < 1 then
    raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select count(*)::integer, (array_agg(p.id))[1]
  into v_admin_count, v_admin_profile_id
  from public.profiles p
  join auth.users u on u.id = p.auth_user_id
  join public.workspace_memberships m on m.profile_id = p.id
  where m.workspace_id = v_workspace_id and m.active and m.role = 'ADMIN'
    and p.active and p.demo_principal and p.platform_role = 'USER'
    and p.role = 'ADMIN' and not u.is_anonymous;
  -- Initial migrations may run before fixed Demo principals are bootstrapped.
  if v_admin_count = 0 then return false; end if;
  if v_admin_count <> 1 then
    raise exception 'DEMO_PRINCIPAL_AMBIGUOUS' using errcode = 'P0001';
  end if;

  -- Preserve any existing shared Demo knowledge, including a manually
  -- archived/replaced fixture. Reset removes it and starts a fresh generation.
  if exists (select 1 from public.knowledge_documents d
      where d.workspace_id = v_workspace_id) then return false; end if;

  for v_item in
    select fixture.title, fixture.source_text from (values
      ('Fictional QX-731 filter guide',
       'Fictional QX-731 demonstration filter. Replace the QX-731 cartridge every six months during a Demo maintenance visit. Record observed airflow before closing the work order. 虚构示范机型 QX-731：每六个月更换一次滤芯，完成工单前记录风量。'),
      ('Fictional Demo leak triage',
       'For a fictional demonstration water leak, record where the water appears and assign a qualified Demo technician. Do not mark the case complete until the inspection notes are reviewed. 虚构示范漏水案例：记录漏水位置并交由示范技术员检查。')
    ) as fixture(title, source_text)
  loop
    insert into public.knowledge_documents
      (workspace_id, generation, title, source_label, created_by_profile_id)
    values (v_workspace_id, v_generation, v_item.title,
      'Sejuk Ops fictional Demo reference v1', v_admin_profile_id)
    returning id into v_document_id;

    insert into public.knowledge_versions
      (workspace_id, document_id, version_no, generation, source_text, sha256,
       source_kind, index_state, chunk_count, created_by_profile_id)
    values (v_workspace_id, v_document_id, 1, v_generation, v_item.source_text,
      encode(extensions.digest(convert_to(v_item.source_text, 'UTF8'), 'sha256'), 'hex'),
      'TEXT', 'READY', 1, v_admin_profile_id)
    returning id into v_version_id;

    insert into public.knowledge_version_pages
      (workspace_id, document_id, version_id, page_no, content)
    values (v_workspace_id, v_document_id, v_version_id, 1, v_item.source_text);
    insert into public.knowledge_chunks
      (workspace_id, document_id, version_id, ordinal, page_no, section_label, content)
    values (v_workspace_id, v_document_id, v_version_id, 1, 1,
      'Page 1, section 1', v_item.source_text);

    update public.knowledge_documents
    set state = 'PUBLISHED', published_version_id = v_version_id,
      updated_at = clock_timestamp()
    where workspace_id = v_workspace_id and id = v_document_id;
  end loop;
  return true;
end;
$$;


--
-- Name: guest_ai_budget_reserve(uuid, uuid, bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: guest_ai_budget_set_limit(uuid, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: guest_ai_budget_status(uuid, uuid, bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: guest_ai_budget_status_admin(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guest_ai_budget_status_admin(p_actor_auth_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: guest_visit_validate(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guest_visit_validate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.expires_at <= pg_catalog.clock_timestamp()
     or not exists (
       select 1 from public.workspaces w
       where w.id = new.workspace_id and w.kind = 'DEMO' and w.active
         and w.generation = new.demo_generation for share
     ) then
    raise exception 'Guest visit scope is invalid or stale' using errcode = '42501';
  end if;
  return new;
end;
$$;


--
-- Name: knowledge_archive(uuid, bigint, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  update public.knowledge_documents
    set state = 'ARCHIVED', updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and id = p_document_id
      and generation = p_generation and state = 'PUBLISHED'
      and created_by_profile_id = v_profile_id;
  if not found then
    raise exception 'KNOWLEDGE_FORBIDDEN_OR_NOT_PUBLISHED' using errcode = '42501';
  end if;
end;
$$;


--
-- Name: knowledge_claim_index(uuid, bigint, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) RETURNS TABLE(token uuid, page_no integer, page_text text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version public.knowledge_versions; v_token uuid;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_versions v
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation for update;
  if v_version.id is null or v_version.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_INDEX_NOT_CLAIMABLE' using errcode = '22023';
  end if;
  -- The last abandoned lease must become terminal instead of remaining
  -- PROCESSING forever. It cannot alter the published version pointer.
  if v_version.index_state = 'PROCESSING' and v_version.index_attempts >= 10
    and v_version.index_started_at < clock_timestamp() - interval '60 seconds' then
    update public.knowledge_versions v set index_state = 'FAILED',
      index_token = null, index_started_at = null, index_error = 'INDEX_FAILED',
      updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id;
    return;
  end if;
  if v_version.index_attempts >= 10 or not (
      v_version.index_state = 'PENDING' or
      (v_version.index_state = 'PROCESSING' and v_version.index_started_at < clock_timestamp() - interval '60 seconds')
    ) then
    raise exception 'KNOWLEDGE_INDEX_NOT_CLAIMABLE' using errcode = '22023';
  end if;
  v_token := gen_random_uuid();
  update public.knowledge_versions v set index_state = 'PROCESSING', index_token = v_token,
    index_started_at = clock_timestamp(), index_attempts = v.index_attempts + 1,
    index_error = null, updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id and v.id = p_version_id;
  return query select v_token, p.page_no, p.content
    from public.knowledge_version_pages p
    where p.workspace_id = p_workspace_id and p.document_id = p_document_id
      and p.version_id = p_version_id order by p.page_no;
end;
$$;


--
-- Name: knowledge_consume_pdf_attestation(uuid, text[]); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_claim private.knowledge_pdf_stage_attestations; v_version_id uuid;
begin
  if p_token is null or (select auth.uid()) is null then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_claim from private.knowledge_pdf_stage_attestations
    where token = p_token for update;
  if v_claim.token is null or v_claim.actor_auth_user_id <> (select auth.uid())
     or v_claim.expires_at <= clock_timestamp()
     or coalesce(array_length(p_pages, 1), 0) not between 1 and 12
     or char_length(array_to_string(p_pages, E'\f')) not between 1 and 100000
     or v_claim.pages_sha256 is distinct from encode(
       extensions.digest(convert_to(to_jsonb(p_pages)::text, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  v_version_id := private.knowledge_stage_pages(
    v_claim.workspace_id, v_claim.generation, v_claim.document_id,
    'PDF_TEXT', p_pages);
  delete from private.knowledge_pdf_stage_attestations where token = p_token;
  return v_version_id;
end;
$$;


--
-- Name: knowledge_create_document(uuid, bigint, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_id uuid;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or p_source_label is null or char_length(btrim(p_source_label)) not between 1 and 160 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  insert into public.knowledge_documents
    (workspace_id, generation, title, source_label, created_by_profile_id)
  values (p_workspace_id, p_generation, btrim(p_title), btrim(p_source_label), v_profile_id)
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: knowledge_editor(uuid, bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_editor(p_workspace_id uuid, p_generation bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
  if (select auth.uid()) is null then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select p.id into v_profile_id
  from public.profiles p
  join public.workspace_memberships m on m.profile_id = p.id
  join public.workspaces w on w.id = m.workspace_id
  where p.auth_user_id = (select auth.uid()) and p.active
    and m.workspace_id = p_workspace_id and m.active
    and m.role in ('ADMIN', 'MANAGER')
    and w.active and w.generation = p_generation
    and ((select (auth.jwt()->>'is_anonymous')::boolean) is false or w.kind = 'DEMO')
  for share of w;
  if v_profile_id is null then
    raise exception 'KNOWLEDGE_FORBIDDEN_OR_STALE' using errcode = '42501';
  end if;
  return v_profile_id;
end;
$$;


--
-- Name: knowledge_fail_index(uuid, bigint, uuid, uuid, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_document public.knowledge_documents;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_error_code not in ('CHUNK_LIMIT', 'TEXT_UNREADABLE', 'INDEX_FAILED') then
    raise exception 'KNOWLEDGE_INDEX_INVALID' using errcode = '22023';
  end if;
  update public.knowledge_versions v set index_state = 'FAILED', index_token = null,
    index_started_at = null, index_error = p_error_code, updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation
      and v.created_by_profile_id = v_profile_id and v.index_state = 'PROCESSING'
      and v.index_token = p_token and p_token is not null;
  if not found then raise exception 'KNOWLEDGE_INDEX_STALE' using errcode = '22023'; end if;
end;
$$;


--
-- Name: knowledge_finish_index(uuid, bigint, uuid, uuid, uuid, integer[], text[]); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version public.knowledge_versions; v_count integer; v_i integer;
  v_page public.knowledge_version_pages; v_rebuilt text; v_page_sections integer;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_versions v
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation for update;
  if v_version.id is null or v_version.index_state <> 'PROCESSING'
    or v_version.index_token is distinct from p_token or p_token is null then
    raise exception 'KNOWLEDGE_INDEX_STALE' using errcode = '22023';
  end if;
  v_count := coalesce(array_length(p_contents, 1), 0);
  if v_count not between 1 and 64 or v_count <> coalesce(array_length(p_page_numbers, 1), 0) then
    raise exception 'KNOWLEDGE_INDEX_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_page_numbers[v_i] is null or p_contents[v_i] is null
      or char_length(btrim(p_contents[v_i])) not between 1 and 2000
      or (v_i > 1 and p_page_numbers[v_i] < p_page_numbers[v_i-1]) then
      raise exception 'KNOWLEDGE_INDEX_INVALID' using errcode = '22023';
    end if;
  end loop;
  for v_page in select * from public.knowledge_version_pages p
      where p.workspace_id = p_workspace_id and p.document_id = p_document_id
        and p.version_id = p_version_id order by p.page_no loop
    v_rebuilt := ''; v_page_sections := 0;
    for v_i in 1..v_count loop
      if p_page_numbers[v_i] = v_page.page_no then
        v_rebuilt := v_rebuilt || p_contents[v_i];
        v_page_sections := v_page_sections + 1;
      end if;
    end loop;
    if v_rebuilt <> v_page.content then
      raise exception 'KNOWLEDGE_INDEX_SOURCE_MISMATCH' using errcode = '22023';
    end if;
  end loop;
  -- Every supplied page number must exist; the page FK enforces this too.
  delete from public.knowledge_chunks c where c.workspace_id = p_workspace_id
    and c.document_id = p_document_id and c.version_id = p_version_id;
  v_page_sections := 0;
  for v_i in 1..v_count loop
    if v_i = 1 or p_page_numbers[v_i] <> p_page_numbers[v_i-1] then
      v_page_sections := 0;
    end if;
    v_page_sections := v_page_sections + 1;
    insert into public.knowledge_chunks
      (workspace_id, document_id, version_id, ordinal, page_no, section_label, content)
    values (p_workspace_id, p_document_id, p_version_id, v_i, p_page_numbers[v_i],
      'Page ' || p_page_numbers[v_i] || ', section ' || v_page_sections, p_contents[v_i]);
  end loop;
  update public.knowledge_versions v set index_state = 'READY', index_token = null,
    index_started_at = null, index_error = null, chunk_count = v_count,
    updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id and v.id = p_version_id;
end;
$$;


--
-- Name: knowledge_issue_pdf_attestation(uuid, uuid, bigint, uuid, text[], uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_token uuid; v_count integer; v_i integer;
begin
  perform private.staff_require_actor(p_actor_auth_user_id, p_workspace_id, p_actor_session_id);
  if p_actor_auth_user_id is null or p_workspace_id is null or
     p_document_id is null or p_generation is null or p_generation < 1 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_count := coalesce(array_length(p_pages, 1), 0);
  if v_count not between 1 and 12 or
     char_length(array_to_string(p_pages, E'\f')) not between 1 and 100000 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_pages[v_i] is null or char_length(p_pages[v_i]) > 100000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  -- A stale or unrelated actor/document must not receive a usable claim.
  if not exists (
    select 1 from public.knowledge_documents d
    join public.workspaces w on w.id = d.workspace_id
    join public.workspace_memberships m
      on m.workspace_id = d.workspace_id and m.profile_id = d.created_by_profile_id
    join public.profiles p on p.id = m.profile_id
    join auth.users u on u.id = p.auth_user_id
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED'
      and w.active and w.generation = p_generation
      and m.active and m.role in ('ADMIN', 'MANAGER')
      and p.active and p.auth_user_id = p_actor_auth_user_id
      and not u.is_anonymous
  ) then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  delete from private.knowledge_pdf_stage_attestations
    where expires_at <= clock_timestamp();
  insert into private.knowledge_pdf_stage_attestations
    (actor_auth_user_id, workspace_id, generation, document_id, pages_sha256, expires_at)
  values (p_actor_auth_user_id, p_workspace_id, p_generation, p_document_id,
    encode(extensions.digest(convert_to(to_jsonb(p_pages)::text, 'UTF8'), 'sha256'), 'hex'),
    clock_timestamp() + interval '2 minutes')
  returning token into v_token;
  return v_token;
end;
$$;


--
-- Name: knowledge_publish(uuid, bigint, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version public.knowledge_versions;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
  where d.workspace_id = p_workspace_id and d.id = p_document_id
    and d.generation = p_generation and d.state <> 'ARCHIVED'
  for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_version from public.knowledge_versions v
  where v.workspace_id = p_workspace_id and v.document_id = p_document_id
    and v.id = p_version_id and v.generation = p_generation
  for update;
  if v_version.id is null or v_version.index_state <> 'READY'
    or v_version.chunk_count < 1 then
    raise exception 'KNOWLEDGE_VERSION_NOT_READY' using errcode = '22023';
  end if;
  update public.knowledge_versions
    set reviewed_by_profile_id = v_profile_id, reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and document_id = p_document_id
      and id = p_version_id;
  update public.knowledge_documents
    set state = 'PUBLISHED', published_version_id = p_version_id,
      updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and id = p_document_id;
end;
$$;


--
-- Name: knowledge_retry_index(uuid, bigint, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_document public.knowledge_documents;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED' for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  update public.knowledge_versions v set index_state = 'PENDING', index_error = null,
    updated_at = clock_timestamp()
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id
      and v.id = p_version_id and v.generation = p_generation
      and v.created_by_profile_id = v_profile_id and v.index_state = 'FAILED'
      and v.index_attempts < 10;
  if not found then raise exception 'KNOWLEDGE_INDEX_NOT_RETRYABLE' using errcode = '22023'; end if;
end;
$$;


--
-- Name: knowledge_stage_pages(uuid, bigint, uuid, text, text[]); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_stage_pages(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_kind text, p_pages text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_document public.knowledge_documents;
  v_version_id uuid; v_version_no integer; v_text text; v_count integer; v_i integer;
begin
  v_profile_id := private.knowledge_editor(p_workspace_id, p_generation);
  select * into v_document from public.knowledge_documents d
    where d.workspace_id = p_workspace_id and d.id = p_document_id
      and d.generation = p_generation and d.state <> 'ARCHIVED'
    for update;
  if v_document.id is null or v_document.created_by_profile_id <> v_profile_id then
    raise exception 'KNOWLEDGE_FORBIDDEN' using errcode = '42501';
  end if;
  v_count := coalesce(array_length(p_pages, 1), 0);
  if p_source_kind not in ('TEXT', 'PDF_TEXT') or v_count not between 1 and 20
    or (p_source_kind = 'TEXT' and v_count <> 1) then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_pages[v_i] is null or char_length(p_pages[v_i]) > 100000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  v_text := array_to_string(p_pages, E'\f');
  if char_length(v_text) not between 1 and 100000 or btrim(v_text, E' \t\n\r\f') = '' then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  select coalesce(max(v.version_no), 0) + 1 into v_version_no
    from public.knowledge_versions v
    where v.workspace_id = p_workspace_id and v.document_id = p_document_id;
  insert into public.knowledge_versions (
    workspace_id, document_id, version_no, generation, source_text, sha256,
    source_kind, index_state, chunk_count, created_by_profile_id
  ) values (
    p_workspace_id, p_document_id, v_version_no, p_generation, v_text,
    encode(extensions.digest(convert_to(v_text, 'UTF8'), 'sha256'), 'hex'),
    p_source_kind, 'PENDING', 0, v_profile_id
  ) returning id into v_version_id;
  for v_i in 1..v_count loop
    insert into public.knowledge_version_pages
      (workspace_id, document_id, version_id, page_no, content)
    values (p_workspace_id, p_document_id, v_version_id, v_i, p_pages[v_i]);
  end loop;
  return v_version_id;
end;
$$;


--
-- Name: knowledge_stage_text(uuid, bigint, uuid, text, text[]); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_count integer; v_i integer;
begin
  v_count := coalesce(array_length(p_chunks, 1), 0);
  if p_source_text is null or v_count not between 1 and 64 then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_i in 1..v_count loop
    if p_chunks[v_i] is null or char_length(btrim(p_chunks[v_i])) not between 1 and 2000 then
      raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;
  if array_to_string(p_chunks, '') <> p_source_text then
    raise exception 'KNOWLEDGE_INPUT_INVALID' using errcode = '22023';
  end if;
  return private.knowledge_stage_pages(p_workspace_id, p_generation, p_document_id,
    'TEXT', array[p_source_text]);
end;
$$;


--
-- Name: mcp_session_active(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.mcp_session_active(p_auth_user_id uuid, p_session_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from auth.sessions s
    where s.id = p_session_id and s.user_id = p_auth_user_id
      and (s.not_after is null or s.not_after > now())
  );
$$;


--
-- Name: owner_preview_assert_owner(uuid, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_preview_assert_owner(p_workspace_id uuid, p_lock boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_uid uuid := (select auth.uid());
begin
  -- UPDATE serializes preview transitions against command guards' profile SHARE.
  if p_lock then
    select id into v_profile_id from public.profiles where auth_user_id=v_uid for update;
  end if;
  return private.staff_assert_owner(v_uid,private.staff_signed_session_id(),p_workspace_id);
end;
$$;


--
-- Name: owner_preview_audit(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_preview_audit(p_preview_id uuid, p_event text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    select gen_random_uuid(),v.owner_profile_id,p_event,
      jsonb_build_object('actualOwnerProfileId',v.owner_profile_id,'actualOwnerAuthUserId',v.auth_user_id,
        'workspaceId',v.workspace_id,'previewId',v.id,'role',v.role,
        'effectiveEmployeeProfileId',v.effective_employee_profile_id,'readOnly',true)
    from private.owner_previews v where v.id=p_preview_id;
$$;


--
-- Name: owner_preview_employee_valid(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_preview_employee_valid(p_workspace_id uuid, p_profile_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists(select 1 from private.staff_accounts s
    join public.profiles p on p.id=s.profile_id
    join auth.users u on u.id=p.auth_user_id
    join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.profile_id=s.profile_id
    join public.workspace_technicians t on t.workspace_id=s.workspace_id and t.profile_id=s.profile_id
    join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
    where s.workspace_id=p_workspace_id and s.profile_id=p_profile_id and p.active
      and p.platform_role='USER' and not p.demo_principal and not u.is_anonymous
      and s.auth_user_id=p.auth_user_id and m.active and m.role='TECHNICIAN' and t.active and b.active);
$$;


--
-- Name: owner_preview_json(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_preview_json(p_preview_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v private.owner_previews; v_name text;
begin
  select * into v from private.owner_previews where id=p_preview_id;
  if v.id is null or not private.owner_preview_valid(v.id) then
    raise exception 'OWNER_PREVIEW_INVALID_EXIT_REQUIRED' using errcode='42501'; end if;
  select display_name into v_name from public.profiles where id=v.effective_employee_profile_id;
  return jsonb_build_object('previewId',v.id,'role',v.role,
    'effectiveEmployeeProfileId',v.effective_employee_profile_id,'effectiveEmployeeName',v_name,'readOnly',true);
end;
$$;


--
-- Name: owner_preview_read_allowed(uuid, text, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_preview_read_allowed(p_workspace_id uuid, p_kind text, p_row_id uuid, p_version_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v private.owner_previews; v_profile uuid; v_role public.app_role; v_technician uuid; v_branch uuid;
begin
  select * into v from private.owner_previews where session_id=private.staff_signed_session_id();
  if v.id is not null then
    if v.auth_user_id is distinct from (select auth.uid()) or v.workspace_id<>p_workspace_id
      or not private.owner_preview_valid(v.id) then return false; end if;
    v_role := v.role; v_profile := v.effective_employee_profile_id;
    if p_kind='proposals' then
      if v_role='TECHNICIAN' then return false; end if;
      return exists(select 1 from public.workspace_assignment_proposals a where a.workspace_id=p_workspace_id and a.id=p_row_id
        and (a.initiated_by_profile_id=v.owner_profile_id or a.approver_profile_id=v.owner_profile_id));
    end if;
    if p_kind in ('documents','versions','chunks','pages') then
      return exists(select 1 from public.knowledge_documents d
        join public.workspaces w on w.id=d.workspace_id
        join public.knowledge_versions k on k.workspace_id=d.workspace_id and k.document_id=d.id and k.id=d.published_version_id
        where d.workspace_id=p_workspace_id and d.id=p_row_id and w.active and d.generation=w.generation
          and k.generation=w.generation and d.state='PUBLISHED' and k.index_state='READY'
          and (p_kind='documents' or k.id=p_version_id));
    end if;
  else
    -- Only formal managed Technicians receive the additional directory fence.
    select p.id,m.role into v_profile,v_role from public.profiles p
      join private.staff_accounts s on s.profile_id=p.id and s.workspace_id=p_workspace_id
      join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.profile_id=p.id
      where p.auth_user_id=(select auth.uid()) and p.active and m.active;
    if v_role is distinct from 'TECHNICIAN'::public.app_role then return true; end if;
    if p_kind not in ('orders','customers','technicians','branches') then return true; end if;
  end if;
  if v_role='ADMIN' then return p_kind in ('orders','customers','technicians','branches'); end if;
  if v_role='MANAGER' then
    -- Manager read visibility matches the real role; scheduling eligibility is
    -- checked separately by command code, which previews cannot execute.
    return p_kind in ('orders','customers','technicians','branches');
  end if;
  select t.id,t.branch_id into v_technician,v_branch from public.workspace_technicians t
    join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
    where t.workspace_id=p_workspace_id and t.profile_id=v_profile and t.active and b.active;
  if v_technician is null then return false; end if;
  if p_kind='orders' then return exists(select 1 from public.workspace_orders o where o.workspace_id=p_workspace_id
    and o.id=p_row_id and o.assigned_technician_id=v_technician); end if;
  if p_kind='customers' then return exists(select 1 from public.workspace_orders o where o.workspace_id=p_workspace_id
    and o.customer_id=p_row_id and o.assigned_technician_id=v_technician); end if;
  if p_kind='technicians' then return p_row_id=v_technician; end if;
  if p_kind='branches' then return p_row_id=v_branch; end if;
  -- Other normal Technician roots retain their existing RLS behavior.
  return v.id is null;
end;
$$;


--
-- Name: owner_preview_valid(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_preview_valid(p_preview_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists(select 1 from private.owner_previews v
    join auth.sessions a on a.id=v.session_id and a.user_id=v.auth_user_id
    join auth.users u on u.id=v.auth_user_id
    join public.profiles p on p.id=v.owner_profile_id and p.auth_user_id=v.auth_user_id
    join public.workspace_memberships m on m.workspace_id=v.workspace_id and m.profile_id=p.id
    join public.workspaces w on w.id=v.workspace_id
    where v.id=p_preview_id and v.expires_at>clock_timestamp()
      and (a.not_after is null or a.not_after>clock_timestamp()) and not u.is_anonymous
      and p.active and p.platform_role='SUPER_ADMIN' and not p.demo_principal
      and m.active and w.active and w.kind='OWNER'
      and ((v.role in ('ADMIN','MANAGER') and v.effective_employee_profile_id is null)
        or (v.role='TECHNICIAN' and private.owner_preview_employee_valid(v.workspace_id,v.effective_employee_profile_id))));
$$;


--
-- Name: staff_account_summary(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_account_summary(p_profile_id uuid) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object('profileId',p.id,'name',p.display_name,'email',s.email,
    'role',m.role,'branchCode',case when m.role = 'TECHNICIAN' then b.code else null end,
    'active',p.active and m.active,'passwordChangeRequired',
      s.password_change_required or not coalesce(private.staff_password_current(s.profile_id),false),
    'authRevision',s.auth_revision)
  from private.staff_accounts s join public.profiles p on p.id = s.profile_id
    join public.workspace_memberships m on m.profile_id = s.profile_id and m.workspace_id = s.workspace_id
    left join public.workspace_technicians t on t.profile_id = s.profile_id and t.workspace_id = s.workspace_id
    left join public.workspace_branches b on b.id = t.branch_id and b.workspace_id = t.workspace_id
  where s.profile_id = p_profile_id;
$$;


--
-- Name: staff_actor_ready(uuid, uuid, uuid, boolean, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_actor_ready(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid, p_lock boolean DEFAULT false, p_allow_password_pending boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile public.profiles; v_staff private.staff_accounts; v_fingerprint text;
begin
  if p_auth_user_id is null then return false; end if;
  if p_lock then
    select * into v_profile from public.profiles where auth_user_id = p_auth_user_id for share;
  else
    select * into v_profile from public.profiles where auth_user_id = p_auth_user_id;
  end if;
  if v_profile.id is null or not v_profile.active then return false; end if;
  -- Invalid/expired previews still deny commands until explicit exit. A service
  -- caller omitting proof cannot select a preview-free session by using NULL.
  if p_lock and exists(select 1 from private.owner_previews v
    where v.auth_user_id=p_auth_user_id
      and (p_workspace_id is null or v.workspace_id=p_workspace_id)
      and (p_session_id is null or v.session_id=p_session_id)) then return false; end if;
  -- Supplied permanent Owner proof must stay live after preview FK cleanup.
  -- Legacy NULL proof remains compatible; this is not full legacy JWT revocation.
  if v_profile.platform_role='SUPER_ADMIN' and not v_profile.demo_principal and p_session_id is not null then
    if p_lock then
      perform 1 from auth.sessions a join auth.users u on u.id=a.user_id
        where a.id=p_session_id and a.user_id=p_auth_user_id and not u.is_anonymous
          and (a.not_after is null or a.not_after>clock_timestamp()) for share of a;
    else
      perform 1 from auth.sessions a join auth.users u on u.id=a.user_id
        where a.id=p_session_id and a.user_id=p_auth_user_id and not u.is_anonymous
          and (a.not_after is null or a.not_after>clock_timestamp());
    end if;
    if not found then return false; end if;
  end if;
  if p_lock then
    select * into v_staff from private.staff_accounts where profile_id = v_profile.id for share;
  else
    select * into v_staff from private.staff_accounts where profile_id = v_profile.id;
  end if;
  if v_staff.profile_id is null then return true; end if;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_fingerprint is null then return false; end if;
  if v_profile.platform_role <> 'USER' or v_profile.demo_principal
    or v_staff.auth_user_id <> p_auth_user_id
    or (p_workspace_id is not null and p_workspace_id <> v_staff.workspace_id)
    or (not p_allow_password_pending and (v_staff.password_change_required
      or not coalesce(private.staff_password_current(v_profile.id),false)))
    or p_session_id is null then return false; end if;
  if p_lock then
    perform 1 from public.workspace_memberships m
      where m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active for share;
  else
    perform 1 from public.workspace_memberships m
      where m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active;
  end if;
  if not found then return false; end if;
  return exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    join public.workspaces w on w.id = v_staff.workspace_id
    where s.id = p_session_id and s.user_id = p_auth_user_id
      and s.created_at > v_staff.sessions_valid_after
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.is_anonymous is false and w.active and w.kind = 'OWNER'
  );
end;
$$;


--
-- Name: staff_assert_owner(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_assert_owner(p_auth_user_id uuid, p_session_id uuid, p_workspace_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid;
begin
  select p.id into v_profile_id from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    where p.auth_user_id = p_auth_user_id and p.active and not p.demo_principal
      and p.platform_role = 'SUPER_ADMIN' and u.is_anonymous is false for share of p;
  if v_profile_id is null or p_session_id is null or not exists (
    select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_auth_user_id
      and (s.not_after is null or s.not_after > clock_timestamp())
  ) then raise exception 'STAFF_OWNER_REQUIRED' using errcode = '42501'; end if;
  perform 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id
    where m.profile_id = v_profile_id and m.workspace_id = p_workspace_id and m.active
      and w.active and w.kind = 'OWNER' for share of m,w;
  if not found then raise exception 'STAFF_WORKSPACE_FORBIDDEN' using errcode = '42501'; end if;
  return v_profile_id;
end;
$$;


--
-- Name: staff_auth_password_fingerprint(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_auth_password_fingerprint(p_auth_user_id uuid) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case when u.encrypted_password is not null and char_length(u.encrypted_password)>0
    then encode(extensions.digest(u.encrypted_password,'sha256'),'hex') else null end
  from auth.users u where u.id = p_auth_user_id;
$$;


--
-- Name: staff_current_actor_ready(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_current_actor_ready(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.staff_actor_ready((select auth.uid()), p_workspace_id,
    private.staff_signed_session_id(), false, false);
$$;


--
-- Name: staff_identity_guard(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_identity_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_staff private.staff_accounts; v_profile public.profiles;
begin
  if tg_table_name = 'staff_accounts' then
    if tg_op = 'UPDATE' and (new.profile_id, new.auth_user_id, new.workspace_id, new.email)
      is distinct from (old.profile_id, old.auth_user_id, old.workspace_id, old.email) then
      raise exception 'STAFF_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;
    select * into v_profile from public.profiles where id = new.profile_id for share;
    if v_profile.id is null or v_profile.auth_user_id is distinct from new.auth_user_id
      or v_profile.platform_role <> 'USER' or v_profile.demo_principal
      or not exists (select 1 from auth.users u where u.id = new.auth_user_id and u.is_anonymous is false)
      or not exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.kind = 'OWNER')
      or exists (select 1 from public.workspace_memberships m where m.profile_id = new.profile_id and m.workspace_id <> new.workspace_id) then
      raise exception 'STAFF_IDENTITY_INVALID' using errcode = '23514';
    end if;
  elsif tg_table_name = 'profiles' then
    select * into v_staff from private.staff_accounts where profile_id = old.id;
    if v_staff.profile_id is not null and (new.id is distinct from old.id
      -- Preserve the pre-existing Auth FK ON DELETE SET NULL. A surviving Auth
      -- identity cannot be unlinked; an already deleted parent may cascade.
      or (new.auth_user_id is distinct from v_staff.auth_user_id and
        (new.auth_user_id is not null or exists (select 1 from auth.users where id = v_staff.auth_user_id)))
      or new.platform_role <> 'USER' or new.demo_principal) then
      raise exception 'STAFF_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;
  elsif tg_table_name = 'workspace_memberships' then
    select * into v_staff from private.staff_accounts where profile_id = new.profile_id;
    if v_staff.profile_id is not null and new.workspace_id <> v_staff.workspace_id then
      raise exception 'STAFF_WORKSPACE_IMMUTABLE' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id
      and exists (select 1 from private.staff_accounts where profile_id = old.profile_id) then
      raise exception 'STAFF_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: staff_import_input_valid(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_import_input_valid(p_input jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
  select coalesce(private.staff_input_valid(p_input,p_input->>'email')
    and jsonb_typeof(p_input->'email')='string'
    and char_length(p_input->>'email') between 3 and 254
    and p_input->>'email'=lower(btrim(p_input->>'email'))
    and p_input->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+$',false);
$_$;


--
-- Name: staff_initialize_password_fingerprint(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_initialize_password_fingerprint() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_fingerprint text := private.staff_auth_password_fingerprint(new.auth_user_id);
begin
  if v_fingerprint is null then raise exception 'STAFF_AUTH_PASSWORD_UNAVAILABLE' using errcode='42501'; end if;
  update private.staff_accounts set auth_password_fingerprint=v_fingerprint where profile_id=new.profile_id;
  return new;
end;
$$;


--
-- Name: staff_input_valid(jsonb, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_input_valid(p_input jsonb, p_email text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
  select coalesce(
    jsonb_typeof(p_input) = 'object'
    and p_input ?& array['name','email','role','branchCode']
    and (p_input - array['name','email','role','branchCode']) = '{}'::jsonb
    and jsonb_typeof(p_input->'name') = 'string'
    and char_length(btrim(p_input->>'name')) between 1 and 100
    and p_input->>'email' = p_email
    and jsonb_typeof(p_input->'role') = 'string'
    and p_input->>'role' in ('ADMIN','MANAGER','TECHNICIAN')
    and case when p_input->>'role' = 'TECHNICIAN' then
      jsonb_typeof(p_input->'branchCode') = 'string'
      and char_length(p_input->>'branchCode') between 1 and 32
      and p_input->>'branchCode' ~ '^[A-Za-z0-9_-]+$'
    else p_input->'branchCode' = 'null'::jsonb end,
    false);
$_$;


--
-- Name: staff_password_current(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_password_current(p_profile_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(s.auth_password_fingerprint = private.staff_auth_password_fingerprint(s.auth_user_id),false)
    and s.auth_password_fingerprint is not null
  from private.staff_accounts s where s.profile_id = p_profile_id;
$$;


--
-- Name: staff_password_reset_reconcile(uuid, uuid, uuid, uuid, uuid, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_password_reset_reconcile(p_request_key uuid, p_owner_profile_id uuid, p_workspace_id uuid, p_profile_id uuid, p_claim_token uuid DEFAULT NULL::uuid, p_require_live_claim boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_operation private.staff_password_resets; v_staff private.staff_accounts;
  v_fingerprint text; v_marker text;
begin
  select * into v_operation from private.staff_password_resets where id=p_request_key for update;
  if v_operation.id is null or v_operation.owner_profile_id<>p_owner_profile_id
    or v_operation.workspace_id<>p_workspace_id or v_operation.profile_id<>p_profile_id
    or (p_require_live_claim and (p_claim_token is null or v_operation.claim_token<>p_claim_token
      or v_operation.claim_expires_at<=clock_timestamp())) then
    raise exception 'STAFF_REQUEST_CONFLICT' using errcode='40001';
  end if;
  if v_operation.state='RESET' then
    return jsonb_build_object('state','RESET','account',private.staff_account_summary(p_profile_id));
  end if;
  select * into v_staff from private.staff_accounts where profile_id=p_profile_id;
  if v_staff.profile_id is null or v_staff.auth_user_id<>v_operation.auth_user_id
    or v_staff.auth_revision<>v_operation.reset_revision then
    raise exception 'STAFF_STALE_ACCOUNT' using errcode='40001';
  end if;
  v_fingerprint := private.staff_auth_password_fingerprint(v_operation.auth_user_id);
  select u.raw_app_meta_data->>'sejukops_staff_password_reset' into v_marker
    from auth.users u where u.id=v_operation.auth_user_id;
  if v_marker=v_operation.id::text and v_fingerprint is not null
    and v_fingerprint<>v_operation.initial_fingerprint then
    update private.staff_accounts set password_change_required=true,
      auth_password_fingerprint=v_fingerprint,updated_at=clock_timestamp()
      where profile_id=p_profile_id and auth_revision=v_operation.reset_revision;
    update private.staff_password_resets set state='RESET',updated_at=clock_timestamp()
      where id=v_operation.id and state='RESERVED';
    insert into public.audit_logs(id,actor_profile_id,event_type,idempotency_key,metadata_json)
      values(gen_random_uuid(),p_owner_profile_id,'STAFF_PASSWORD_RESET',p_request_key::text||':reset',
        jsonb_build_object('workspaceId',p_workspace_id,'profileId',p_profile_id))
      on conflict(idempotency_key) do nothing;
    return jsonb_build_object('state','RESET','account',private.staff_account_summary(p_profile_id));
  end if;
  return jsonb_build_object('state','NOT_APPLIED');
end;
$$;


--
-- Name: staff_require_actor(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_require_actor(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.staff_actor_ready(p_auth_user_id, p_workspace_id, p_session_id, true, false) then
    raise exception 'STAFF_BUSINESS_FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;


--
-- Name: staff_signed_session_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_signed_session_id() RETURNS uuid
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare v_claim text := (select auth.jwt()->>'session_id');
begin
  if v_claim is null or v_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return v_claim::uuid;
end;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: workspace_assignment_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_assignment_proposals (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    initiated_by_profile_id uuid NOT NULL,
    approver_profile_id uuid,
    executed_by_profile_id uuid,
    idempotency_key uuid NOT NULL,
    action_type text DEFAULT 'ASSIGN_WORKSPACE_ORDER'::text NOT NULL,
    canonical_payload jsonb NOT NULL,
    target_order_id uuid NOT NULL,
    target_updated_at timestamp with time zone NOT NULL,
    dataset_generation bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status public.workspace_assignment_proposal_status DEFAULT 'PENDING'::public.workspace_assignment_proposal_status NOT NULL,
    approval_channel text,
    execution_source text,
    result_order_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    executed_at timestamp with time zone,
    CONSTRAINT workspace_assignment_proposals_action_type_check CHECK ((action_type = 'ASSIGN_WORKSPACE_ORDER'::text)),
    CONSTRAINT workspace_assignment_proposals_approval_channel_check CHECK (((approval_channel IS NULL) OR (approval_channel = 'WEB'::text))),
    CONSTRAINT workspace_assignment_proposals_canonical_payload_check CHECK ((jsonb_typeof(canonical_payload) = 'object'::text)),
    CONSTRAINT workspace_assignment_proposals_check CHECK ((expires_at > created_at)),
    CONSTRAINT workspace_assignment_proposals_check1 CHECK ((((status = 'PENDING'::public.workspace_assignment_proposal_status) AND (approver_profile_id IS NULL) AND (approved_at IS NULL)) OR ((status <> 'PENDING'::public.workspace_assignment_proposal_status) AND (approver_profile_id IS NOT NULL) AND (approved_at IS NOT NULL)) OR ((status = ANY (ARRAY['STALE'::public.workspace_assignment_proposal_status, 'EXPIRED'::public.workspace_assignment_proposal_status])) AND (approver_profile_id IS NULL)))),
    CONSTRAINT workspace_assignment_proposals_check2 CHECK (((status = 'EXECUTED'::public.workspace_assignment_proposal_status) = (executed_at IS NOT NULL))),
    CONSTRAINT workspace_assignment_proposals_dataset_generation_check CHECK ((dataset_generation > 0)),
    CONSTRAINT workspace_assignment_proposals_execution_source_check CHECK (((execution_source IS NULL) OR (execution_source = 'WEB'::text)))
);


--
-- Name: workspace_assignment_proposal_approve(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid DEFAULT NULL::uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_approver_profile_id uuid;
  v_proposal public.workspace_assignment_proposals;
  v_generation bigint;
  v_order public.workspace_orders;
  v_stale_reason text;
begin
  perform private.staff_require_actor(p_approver_auth_user_id, p_workspace_id, p_actor_session_id);
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


--
-- Name: workspace_assignment_proposal_create(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_assignment_proposal_create_mcp(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
begin
  perform private.staff_require_actor(p_initiator_auth_user_id, p_workspace_id, null);
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


--
-- Name: workspace_assignment_proposal_execute(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_assignment_proposal_immutable(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_assignment_proposal_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_assignment_proposal_insert(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_assignment_proposal_insert(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_profile_id uuid, p_source_client text) RETURNS public.workspace_assignment_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_generation bigint;
  v_order public.workspace_orders;
  v_payload jsonb;
  v_proposal public.workspace_assignment_proposals;
begin
  perform private.staff_require_actor(
    (select p.auth_user_id from public.profiles p where p.id = p_initiator_profile_id),
    p_workspace_id, case when (select auth.uid()) =
      (select p.auth_user_id from public.profiles p where p.id = p_initiator_profile_id)
      then private.staff_signed_session_id() else null end);
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


--
-- Name: workspace_member_can_read(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_member_can_read(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.workspaces w
    join public.workspace_memberships m on m.workspace_id = w.id
    join public.profiles p on p.id = m.profile_id
    where w.id = p_workspace_id
      and w.active and m.active and p.active
      and p.auth_user_id = (select auth.uid())
      and (
        (select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO'
      )
  );
$$;


--
-- Name: workspace_order_admin_profile(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_admin_profile(p_workspace_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
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


--
-- Name: workspace_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_orders (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text NOT NULL,
    branch_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    assigned_technician_id uuid,
    problem_description text NOT NULL,
    service_type text NOT NULL,
    status public.service_order_status DEFAULT 'NEW'::public.service_order_status NOT NULL,
    scheduled_at timestamp with time zone,
    created_by_profile_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_order_assignment_required CHECK (((status = 'NEW'::public.service_order_status) OR (assigned_technician_id IS NOT NULL))),
    CONSTRAINT workspace_orders_order_no_check CHECK ((btrim(order_no) <> ''::text)),
    CONSTRAINT workspace_orders_problem_description_check CHECK ((btrim(problem_description) <> ''::text)),
    CONSTRAINT workspace_orders_service_type_check CHECK ((btrim(service_type) <> ''::text))
);


--
-- Name: workspace_order_assign(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_assign(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_order_assign_current(uuid, bigint, uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_assign_current(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.workspace_order_require_generation(p_workspace_id, p_expected_generation);
  return private.workspace_order_assign(
    p_workspace_id, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at
  );
end;
$$;


--
-- Name: workspace_order_create(uuid, text, uuid, uuid, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_create(p_workspace_id uuid, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_order_create_current(uuid, bigint, text, uuid, uuid, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_create_current(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.workspace_order_require_generation(p_workspace_id, p_expected_generation);
  return private.workspace_order_create(
    p_workspace_id, p_order_no, p_branch_id, p_customer_id,
    p_problem_description, p_service_type
  );
end;
$$;


--
-- Name: workspace_order_create_with_customer(uuid, bigint, text, uuid, text, text, text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_customer_id uuid;
begin
  perform private.workspace_order_require_generation(p_workspace_id, p_expected_generation);
  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 1 and 160
     or p_customer_address is null or char_length(btrim(p_customer_address)) not between 1 and 800
     or (p_customer_phone is not null and
         (char_length(p_customer_phone) > 40 or p_customer_phone !~ '^\+?[0-9][0-9 -]{6,20}$'))
  then
    raise exception 'WORKSPACE_CUSTOMER_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.workspace_customers (workspace_id, name, phone, address)
  values (p_workspace_id, btrim(p_customer_name),
          nullif(btrim(p_customer_phone), ''), btrim(p_customer_address))
  returning id into v_customer_id;

  return private.workspace_order_create(
    p_workspace_id, p_order_no, p_branch_id, v_customer_id,
    p_problem_description, p_service_type
  );
end;
$_$;


--
-- Name: workspace_order_manager_reschedule(uuid, bigint, uuid, timestamp with time zone, timestamp with time zone, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_workspace_kind public.workspace_kind;
  v_generation bigint;
  v_previous_schedule timestamptz;
  v_order public.workspace_orders;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
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


--
-- Name: workspace_order_manual_actor(uuid, bigint, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_manual_actor(p_workspace_id uuid, p_expected_generation bigint, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_kind public.workspace_kind;
  v_generation bigint;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
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


--
-- Name: workspace_order_manual_assign(uuid, bigint, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_manual_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_order_manual_create(uuid, bigint, text, uuid, uuid, text, text, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_manual_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: workspace_order_manual_create_with_customer(uuid, bigint, text, uuid, text, text, text, text, text, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_manual_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: workspace_order_require_generation(uuid, bigint); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_require_generation(p_workspace_id uuid, p_expected_generation bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_generation bigint;
begin
  perform private.workspace_order_admin_profile(p_workspace_id);
  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null or p_expected_generation is null
    or v_generation <> p_expected_generation then
    raise exception 'WORKSPACE_GENERATION_STALE' using errcode = 'P0001';
  end if;
end;
$$;


--
-- Name: workspace_order_technician_transition(uuid, bigint, uuid, timestamp with time zone, public.service_order_status, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_demo_principal boolean;
  v_persona public.app_role;
  v_workspace_kind public.workspace_kind;
  v_generation bigint;
  v_old_status public.service_order_status;
  v_order public.workspace_orders;
begin
  perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());
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


--
-- Name: admin_delete_ai_provider(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform public.ai_assert_config_actor(p_actor_profile_id);
  perform 1 from public.ai_provider_configs c
  where c.id = p_provider_config_id for update;
  if not found then
    raise exception 'AI_PROVIDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  delete from public.ai_task_routes r
  where r.provider_config_id = p_provider_config_id;
  update public.ai_settings s
  set default_provider_config_id = null,
      updated_by = p_actor_profile_id,
      updated_at = pg_catalog.clock_timestamp()
  where s.default_provider_config_id = p_provider_config_id;
  delete from public.ai_provider_configs c
  where c.id = p_provider_config_id;

  insert into public.audit_logs (
    id, actor_profile_id, event_type, metadata_json
  ) values (
    extensions.gen_random_uuid(), p_actor_profile_id,
    'AI_PROVIDER_CONFIG_UPDATED',
    pg_catalog.jsonb_build_object(
      'providerConfigId', p_provider_config_id,
      'operation', 'DELETED'
    )
  );
  return true;
end;
$$;


--
-- Name: admin_update_ai_routing(uuid, public.ai_routing_mode, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_ai_routing(p_actor_profile_id uuid, p_routing_mode public.ai_routing_mode, p_default_provider_config_id uuid, p_routes jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_task_name text;
  v_provider_value jsonb;
  v_provider_id uuid;
  v_capabilities jsonb;
  v_route_key_count integer;
begin
  perform public.ai_assert_config_actor(p_actor_profile_id);
  p_routes := coalesce(p_routes, '{}'::jsonb);
  if pg_catalog.jsonb_typeof(p_routes) <> 'object' then
    raise exception 'INVALID_AI_ROUTES' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_routes) as route_key
    where route_key not in (
      'OPERATIONS_QUERY', 'WORKFLOW_EXPLANATION',
      'OPERATIONAL_INSIGHT', 'DOCUMENT_UNDERSTANDING'
    )
  ) then
    raise exception 'INVALID_AI_TASK' using errcode = '22023';
  end if;

  if p_routing_mode = 'SINGLE_MODEL' then
    if p_routes <> '{}'::jsonb then
      raise exception 'SINGLE_MODEL_ROUTES_NOT_ALLOWED' using errcode = '22023';
    end if;
    if p_default_provider_config_id is not null then
      select c.capabilities into v_capabilities
      from public.ai_provider_configs c
      where c.id = p_default_provider_config_id
        and c.status = 'ACTIVE'
        and c.encrypted_api_key is not null
        and c.api_key_iv is not null
        and c.api_key_auth_tag is not null
        and c.encryption_version = 1;
      if v_capabilities is null then
        raise exception 'AI_PROVIDER_NOT_ROUTABLE' using errcode = 'P0001';
      end if;
      if not public.ai_profile_supports_task(v_capabilities, 'OPERATIONS_QUERY')
        or not public.ai_profile_supports_task(v_capabilities, 'WORKFLOW_EXPLANATION')
        or not public.ai_profile_supports_task(v_capabilities, 'OPERATIONAL_INSIGHT')
        or not public.ai_profile_supports_task(v_capabilities, 'DOCUMENT_UNDERSTANDING')
      then
        raise exception 'AI_CAPABILITY_MISMATCH' using errcode = 'P0001';
      end if;
    end if;
  else
    if p_default_provider_config_id is not null then
      raise exception 'TASK_ROUTING_DEFAULT_NOT_ALLOWED' using errcode = '22023';
    end if;
    select pg_catalog.count(*)::integer into v_route_key_count
    from pg_catalog.jsonb_object_keys(p_routes);
    if v_route_key_count <> 4
      or not p_routes ?& array[
        'OPERATIONS_QUERY', 'WORKFLOW_EXPLANATION',
        'OPERATIONAL_INSIGHT', 'DOCUMENT_UNDERSTANDING'
      ]
    then
      raise exception 'INCOMPLETE_AI_ROUTES' using errcode = '22023';
    end if;
    for v_task_name, v_provider_value in
      select key, value from pg_catalog.jsonb_each(p_routes)
    loop
      if v_provider_value = 'null'::jsonb then
        continue;
      end if;
      if pg_catalog.jsonb_typeof(v_provider_value) <> 'string' then
        raise exception 'INVALID_AI_PROVIDER_ROUTE' using errcode = '22023';
      end if;
      v_provider_id := (v_provider_value #>> '{}')::uuid;
      v_capabilities := null;
      select c.capabilities into v_capabilities
      from public.ai_provider_configs c
      where c.id = v_provider_id
        and c.status = 'ACTIVE'
        and c.encrypted_api_key is not null
        and c.api_key_iv is not null
        and c.api_key_auth_tag is not null
        and c.encryption_version = 1;
      if v_capabilities is null then
        raise exception 'AI_PROVIDER_NOT_ROUTABLE' using errcode = 'P0001';
      end if;
      if not public.ai_profile_supports_task(
        v_capabilities, v_task_name::public.ai_task_type
      ) then
        raise exception 'AI_CAPABILITY_MISMATCH' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  insert into public.ai_settings (
    id, routing_mode, default_provider_config_id, updated_by
  ) values (
    '00000000-0000-4000-8000-00000000a100'::uuid,
    p_routing_mode, p_default_provider_config_id, p_actor_profile_id
  )
  on conflict (id) do update set
    routing_mode = excluded.routing_mode,
    default_provider_config_id = excluded.default_provider_config_id,
    updated_by = excluded.updated_by,
    updated_at = pg_catalog.clock_timestamp();

  delete from public.ai_task_routes where task_type is not null;
  if p_routing_mode = 'TASK_BASED' then
    insert into public.ai_task_routes (
      id, task_type, provider_config_id
    )
    select
      extensions.gen_random_uuid(),
      routes.key::public.ai_task_type,
      (routes.value #>> '{}')::uuid
    from pg_catalog.jsonb_each(p_routes) routes
    where routes.value <> 'null'::jsonb;
  end if;

  insert into public.audit_logs (
    id, actor_profile_id, event_type, metadata_json
  ) values (
    extensions.gen_random_uuid(), p_actor_profile_id, 'AI_ROUTING_UPDATED',
    pg_catalog.jsonb_build_object(
      'routingMode', p_routing_mode,
      'defaultProviderConfigId', p_default_provider_config_id,
      'routes', p_routes
    )
  );
  return true;
end;
$$;


--
-- Name: admin_upsert_ai_provider(uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, text, smallint, text, public.ai_provider_status); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid, p_create_request_key uuid, p_create_payload_signature text, p_name text, p_provider_type text, p_base_url text, p_model text, p_capabilities jsonb, p_encrypted_api_key text, p_api_key_iv text, p_api_key_auth_tag text, p_encryption_version smallint, p_key_last4 text, p_status public.ai_provider_status) RETURNS TABLE(provider_config_id uuid, created boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_created boolean;
  v_replay_provider_config_id uuid;
  v_replay_payload_signature text;
begin
  perform public.ai_assert_config_actor(p_actor_profile_id);

  if (p_create_request_key is null) <> (p_create_payload_signature is null)
    or (
      p_create_payload_signature is not null
      and p_create_payload_signature !~ '^[0-9a-f]{64}$'
    )
  then
    raise exception 'INVALID_AI_PROVIDER_IDEMPOTENCY' using errcode = '22023';
  end if;

  if p_create_request_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'ai-provider:create:' || p_create_request_key::text, 0
      )
    );
    select c.id, c.create_payload_signature
    into v_replay_provider_config_id, v_replay_payload_signature
    from public.ai_provider_configs c
    where c.create_request_key = p_create_request_key;
    if v_replay_provider_config_id is not null then
      if v_replay_payload_signature is distinct from p_create_payload_signature then
        raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
      end if;
      return query select v_replay_provider_config_id, false;
      return;
    end if;
  end if;

  if p_provider_config_id is null
    or nullif(btrim(p_name), '') is null
    or p_provider_type <> 'OPENAI_COMPATIBLE'
    or p_base_url !~ '^https://'
    or p_base_url ~ '[@?#]'
    or nullif(btrim(p_model), '') is null
    or p_encrypted_api_key is null
    or p_api_key_iv is null
    or p_api_key_auth_tag is null
    or p_encryption_version <> 1
    or p_key_last4 is null
    or length(p_key_last4) <> 4
    or not (
      pg_catalog.jsonb_typeof(p_capabilities) = 'object'
      and pg_catalog.jsonb_typeof(p_capabilities -> 'text') = 'boolean'
      and pg_catalog.jsonb_typeof(p_capabilities -> 'vision') = 'boolean'
      and pg_catalog.jsonb_typeof(p_capabilities -> 'toolCalling') = 'boolean'
      and pg_catalog.jsonb_typeof(p_capabilities -> 'structuredOutput') = 'boolean'
      and p_capabilities - array[
        'text', 'vision', 'toolCalling', 'structuredOutput'
      ] = '{}'::jsonb
    )
  then
    raise exception 'INVALID_AI_PROVIDER_CONFIG' using errcode = '22023';
  end if;

  select not exists (
    select 1 from public.ai_provider_configs c
    where c.id = p_provider_config_id
  ) into v_created;

  if v_created and p_create_request_key is null then
    raise exception 'AI_PROVIDER_CREATE_REQUEST_KEY_REQUIRED' using errcode = '22023';
  end if;
  if not v_created and p_create_request_key is not null then
    raise exception 'AI_PROVIDER_ID_CONFLICT' using errcode = 'P0001';
  end if;

  insert into public.ai_provider_configs (
    id, name, provider_type, base_url, model, capabilities,
    encrypted_api_key, api_key_iv, api_key_auth_tag, encryption_version,
    key_last4, status, create_request_key, create_payload_signature
  ) values (
    p_provider_config_id, btrim(p_name), p_provider_type, p_base_url,
    btrim(p_model), p_capabilities, p_encrypted_api_key, p_api_key_iv,
    p_api_key_auth_tag, p_encryption_version, p_key_last4, p_status,
    p_create_request_key, p_create_payload_signature
  )
  on conflict (id) do update set
    name = excluded.name,
    provider_type = excluded.provider_type,
    base_url = excluded.base_url,
    model = excluded.model,
    capabilities = excluded.capabilities,
    encrypted_api_key = excluded.encrypted_api_key,
    api_key_iv = excluded.api_key_iv,
    api_key_auth_tag = excluded.api_key_auth_tag,
    encryption_version = excluded.encryption_version,
    key_last4 = excluded.key_last4,
    status = excluded.status;

  insert into public.audit_logs (
    id, actor_profile_id, event_type, metadata_json
  ) values (
    extensions.gen_random_uuid(), p_actor_profile_id,
    'AI_PROVIDER_CONFIG_UPDATED',
    pg_catalog.jsonb_build_object(
      'providerConfigId', p_provider_config_id,
      'operation', case when v_created then 'CREATED' else 'UPDATED' end,
      'status', p_status
    )
  );

  return query select p_provider_config_id, v_created;
end;
$_$;


--
-- Name: ai_assert_config_actor(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_assert_config_actor(p_actor_profile_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id is not null
      and p.platform_role = 'SUPER_ADMIN'
      and p.active
  ) then
    raise exception 'INVALID_PLATFORM_ACTOR' using errcode = 'P0001';
  end if;
  return true;
end;
$$;


--
-- Name: ai_profile_supports_task(jsonb, public.ai_task_type, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_profile_supports_task(p_capabilities jsonb, p_task_type public.ai_task_type, p_input_kind text DEFAULT 'TEXT'::text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case p_task_type
    when 'OPERATIONS_QUERY' then
      coalesce((p_capabilities ->> 'text')::boolean, false)
      and coalesce((p_capabilities ->> 'toolCalling')::boolean, false)
      and coalesce((p_capabilities ->> 'structuredOutput')::boolean, false)
    when 'WORKFLOW_EXPLANATION' then
      coalesce((p_capabilities ->> 'text')::boolean, false)
    when 'OPERATIONAL_INSIGHT' then
      coalesce((p_capabilities ->> 'text')::boolean, false)
    when 'DOCUMENT_UNDERSTANDING' then
      coalesce((p_capabilities ->> 'text')::boolean, false)
      and coalesce((p_capabilities ->> 'structuredOutput')::boolean, false)
      and (
        p_input_kind <> 'IMAGE'
        or coalesce((p_capabilities ->> 'vision')::boolean, false)
      )
    else false
  end;
$$;


--
-- Name: demo_reset(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint) RETURNS bigint
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.demo_reset(p_actor_auth_user_id, p_expected_generation);
$$;


--
-- Name: demo_reset_inventory(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demo_reset_inventory() RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.demo_reset_inventory();
$$;


--
-- Name: demo_seed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demo_seed() RETURNS boolean
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.demo_seed();
$$;


--
-- Name: guest_ai_budget_reserve(uuid, uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.guest_ai_budget_reserve(p_visit_id, p_workspace_id, p_generation)
$$;


--
-- Name: guest_ai_budget_set_limit(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer) RETURNS integer
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.guest_ai_budget_set_limit(p_actor_auth_user_id, p_daily_limit)
$$;


--
-- Name: guest_ai_budget_status(uuid, uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.guest_ai_budget_status(p_visit_id, p_workspace_id, p_generation)
$$;


--
-- Name: guest_ai_budget_status_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guest_ai_budget_status_admin(p_actor_auth_user_id uuid) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.guest_ai_budget_status_admin(p_actor_auth_user_id)
$$;


--
-- Name: knowledge_archive(uuid, bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_archive(p_workspace_id, p_generation, p_document_id); $$;


--
-- Name: knowledge_claim_index(uuid, bigint, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) RETURNS TABLE(token uuid, page_no integer, page_text text)
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select * from private.knowledge_claim_index(p_workspace_id,p_generation,p_document_id,p_version_id); $$;


--
-- Name: knowledge_consume_pdf_attestation(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) RETURNS uuid
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.knowledge_consume_pdf_attestation(p_token, p_pages);
$$;


--
-- Name: knowledge_create_document(uuid, bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) RETURNS uuid
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_create_document(p_workspace_id, p_generation, p_title, p_source_label); $$;


--
-- Name: knowledge_fail_index(uuid, bigint, uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_fail_index(p_workspace_id,p_generation,p_document_id,
  p_version_id,p_token,p_error_code); $$;


--
-- Name: knowledge_finish_index(uuid, bigint, uuid, uuid, uuid, integer[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_finish_index(p_workspace_id,p_generation,p_document_id,
  p_version_id,p_token,p_page_numbers,p_contents); $$;


--
-- Name: knowledge_issue_pdf_attestation(uuid, uuid, bigint, uuid, text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.knowledge_issue_pdf_attestation(
    p_actor_auth_user_id, p_workspace_id, p_generation, p_document_id, p_pages, p_actor_session_id);
$$;


--
-- Name: knowledge_publish(uuid, bigint, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_publish(p_workspace_id, p_generation, p_document_id, p_version_id); $$;


--
-- Name: knowledge_retry_index(uuid, bigint, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_retry_index(p_workspace_id,p_generation,p_document_id,p_version_id); $$;


--
-- Name: knowledge_search_keyword(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_search_keyword(p_workspace_id uuid, p_query text, p_limit integer DEFAULT 10) RETURNS TABLE(workspace_id uuid, document_id uuid, version_id uuid, ordinal integer, page_no integer, title text, source_label text, section_label text, content text)
    LANGUAGE sql
    SET search_path TO ''
    AS $_$
  with search as (
    select btrim(p_query) as literal_query,
      case when btrim(p_query) ~ '^[A-Za-z[:space:][:punct:]]+$'
        then pg_catalog.ts_rewrite(
          pg_catalog.ts_rewrite(
            pg_catalog.ts_rewrite(
              pg_catalog.ts_rewrite(
                pg_catalog.plainto_tsquery('english'::regconfig, btrim(p_query)),
                'cartridg'::tsquery, '(cartridg | filter)'::tsquery),
              'filter'::tsquery, '(cartridg | filter)'::tsquery),
            'chang'::tsquery, '(chang | replac)'::tsquery),
          'replac'::tsquery, '(chang | replac)'::tsquery)
        else null::tsquery end as english_query
  )
  select d.workspace_id, d.id, v.id, c.ordinal, c.page_no, d.title, d.source_label,
    c.section_label, c.content
  from public.knowledge_documents d
  join public.workspaces w on w.id = d.workspace_id
  join public.knowledge_versions v on v.workspace_id = d.workspace_id
    and v.document_id = d.id and v.id = d.published_version_id
  join public.knowledge_chunks c on c.workspace_id = v.workspace_id
    and c.document_id = v.document_id and c.version_id = v.id
  cross join search s
  where d.workspace_id = p_workspace_id and d.state = 'PUBLISHED'
    and d.generation = w.generation and v.generation = w.generation
    and v.index_state = 'READY' and char_length(s.literal_query) between 1 and 120
    and (
      position(lower(s.literal_query) in lower(c.content)) > 0
      or (pg_catalog.numnode(s.english_query) > 0
        and pg_catalog.to_tsvector('english'::regconfig, c.content) @@ s.english_query)
    )
  order by
    (position(lower(s.literal_query) in lower(c.content)) > 0) desc,
    pg_catalog.ts_rank_cd(pg_catalog.to_tsvector('english'::regconfig, c.content), s.english_query) desc nulls last,
    d.updated_at desc, c.ordinal
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
$_$;


--
-- Name: knowledge_stage_text(uuid, bigint, uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) RETURNS uuid
    LANGUAGE sql
    SET search_path TO ''
    AS $$ select private.knowledge_stage_text(p_workspace_id, p_generation, p_document_id, p_source_text, p_chunks); $$;


--
-- Name: mcp_session_active(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mcp_session_active(p_auth_user_id uuid, p_session_id uuid) RETURNS boolean
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.mcp_session_active(p_auth_user_id, p_session_id);
$$;


--
-- Name: owner_preview_exit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_preview_exit() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v private.owner_previews; v_uid uuid := (select auth.uid()); v_profile_id uuid; v_workspace_id uuid;
begin
  -- Always lock before reading state, including a no-op exit racing with entry.
  select id into v_profile_id from public.profiles where auth_user_id=v_uid for update;
  select * into v from private.owner_previews where session_id=private.staff_signed_session_id() for update;
  if v.id is null then
    select w.id into v_workspace_id from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id
      where m.profile_id=v_profile_id and m.active and w.active and w.kind='OWNER';
    if v_workspace_id is null then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501'; end if;
    perform private.owner_preview_assert_owner(v_workspace_id,true);
    return false;
  end if;
  perform private.owner_preview_assert_owner(v.workspace_id,true);
  if v.auth_user_id is distinct from v_uid then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501'; end if;
  perform private.owner_preview_audit(v.id,'OWNER_PREVIEW_ENDED');
  delete from private.owner_previews where id=v.id;
  return true;
end;
$$;


--
-- Name: owner_preview_options(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_preview_options(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.owner_preview_assert_owner(p_workspace_id);
  return jsonb_build_object('technicians',coalesce((select jsonb_agg(jsonb_build_object(
    'profileId',p.id,'name',p.display_name,'branchCode',b.code) order by p.display_name,p.id)
    from public.profiles p join public.workspace_technicians t on t.profile_id=p.id
    join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
    where t.workspace_id=p_workspace_id and private.owner_preview_employee_valid(p_workspace_id,p.id)),'[]'::jsonb));
end;
$$;


--
-- Name: owner_preview_set(uuid, public.app_role, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_preview_set(p_workspace_id uuid, p_role public.app_role, p_employee_profile_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_session uuid := private.staff_signed_session_id(); v_old private.owner_previews;
  v_id uuid; v_now timestamptz;
begin
  v_owner := private.owner_preview_assert_owner(p_workspace_id,true);
  if p_role is null or p_role not in ('ADMIN','MANAGER','TECHNICIAN')
    or (p_role in ('ADMIN','MANAGER') and p_employee_profile_id is not null)
    or (p_role='TECHNICIAN' and not private.owner_preview_employee_valid(p_workspace_id,p_employee_profile_id)) then
    raise exception 'OWNER_PREVIEW_SELECTION_INVALID' using errcode='22023'; end if;
  select * into v_old from private.owner_previews where session_id=v_session for update;
  if v_old.id is not null then
    if not private.owner_preview_valid(v_old.id) then
      raise exception 'OWNER_PREVIEW_INVALID_EXIT_REQUIRED' using errcode='42501'; end if;
    perform private.owner_preview_audit(v_old.id,'OWNER_PREVIEW_ENDED');
    delete from private.owner_previews where id=v_old.id;
  end if;
  v_now := clock_timestamp();
  insert into private.owner_previews(session_id,auth_user_id,owner_profile_id,workspace_id,role,
    effective_employee_profile_id,created_at,expires_at)
    values(v_session,(select auth.uid()),v_owner,p_workspace_id,p_role,p_employee_profile_id,v_now,v_now+interval '1 hour')
    returning id into v_id;
  perform private.owner_preview_audit(v_id,'OWNER_PREVIEW_STARTED');
  return private.owner_preview_json(v_id);
end;
$$;


--
-- Name: owner_preview_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_preview_status(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v private.owner_previews;
begin
  perform private.owner_preview_assert_owner(p_workspace_id);
  select * into v from private.owner_previews where session_id=private.staff_signed_session_id();
  if v.id is null then return null; end if;
  if v.workspace_id<>p_workspace_id or v.auth_user_id<>(select auth.uid()) then
    raise exception 'OWNER_PREVIEW_INVALID_EXIT_REQUIRED' using errcode='42501'; end if;
  return private.owner_preview_json(v.id);
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: staff_claim_import(uuid, uuid, uuid, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_claim_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_retry_failed boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_import private.staff_imports; v_rows jsonb;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_import from private.staff_imports where id=p_import_id for update;
  if v_import.id is null or v_import.owner_profile_id <> v_owner or v_import.workspace_id <> p_workspace_id
    or v_import.expires_at <= clock_timestamp() then raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
  if v_import.claim_expires_at > clock_timestamp() then raise exception 'STAFF_BUSY' using errcode='55P03'; end if;
  if p_retry_failed then update private.staff_import_rows set state='PENDING',error_code=null
    where import_id=p_import_id and state='FAILED'; end if;
  update private.staff_imports set claim_token=gen_random_uuid(),claim_expires_at=clock_timestamp()+interval '2 minutes',
    expires_at=case when confirmed_at is null then clock_timestamp()+interval '24 hours' else expires_at end,
    confirmed_at=coalesce(confirmed_at,clock_timestamp()),claimed_rows=array(select row_number from private.staff_import_rows
      where import_id=p_import_id and state='PENDING' order by row_number limit 10)
    where id=p_import_id returning * into v_import;
  select coalesce(jsonb_agg(jsonb_build_object('row',r.row_number,'requestKey',r.operation_id,'input',r.input)
    order by r.row_number),'[]'::jsonb) into v_rows from (
      select * from private.staff_import_rows where import_id=p_import_id and state='PENDING' order by row_number limit 10
    ) r;
  return jsonb_build_object('claimToken',v_import.claim_token,'rows',v_rows);
end;
$$;


--
-- Name: staff_complete_password_change(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_complete_password_change(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid, p_claim_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_staff private.staff_accounts; v_claim private.staff_password_claims;
  v_fingerprint text;
begin
  select id into v_profile_id from public.profiles where auth_user_id=p_auth_user_id for update;
  select * into v_staff from private.staff_accounts where profile_id=v_profile_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision<>p_expected_revision
    or not private.staff_actor_ready(p_auth_user_id,v_staff.workspace_id,p_actor_session_id,true,true) then
    raise exception 'STAFF_PASSWORD_COMPLETION_FORBIDDEN' using errcode='42501'; end if;
  select * into v_claim from private.staff_password_claims where id=p_claim_id for update;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_claim.id is null or v_claim.profile_id<>v_profile_id or v_claim.auth_user_id<>p_auth_user_id
    or v_claim.auth_revision<>p_expected_revision or v_claim.consumed_at is not null
    or v_claim.expires_at<=clock_timestamp() or p_actor_session_id=v_claim.original_session_id
    or v_fingerprint is null or v_fingerprint<>v_claim.auth_password_fingerprint
    or not exists(select 1 from auth.sessions s where s.id=p_actor_session_id and s.user_id=p_auth_user_id
      and s.created_at>=v_claim.created_at and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'STAFF_PASSWORD_COMPLETION_FORBIDDEN' using errcode='42501'; end if;
  update private.staff_password_claims set consumed_at=clock_timestamp() where id=v_claim.id;
  update private.staff_accounts set password_change_required=false,auth_revision=gen_random_uuid(),
    auth_password_fingerprint=v_fingerprint,sessions_valid_after=clock_timestamp(),updated_at=clock_timestamp()
    where profile_id=v_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    values(gen_random_uuid(),v_profile_id,'STAFF_PASSWORD_CHANGED',jsonb_build_object('workspaceId',v_staff.workspace_id));
end;
$$;


--
-- Name: staff_fail_creation(uuid, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_fail_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  update private.staff_provisioning set state = 'FAILED',last_error_code = 'PROVISIONING_FAILED',updated_at = clock_timestamp()
    where id = p_request_key and owner_profile_id = v_owner and workspace_id = p_workspace_id
      and claim_token = p_claim_token and state = 'RESERVED';
end;
$$;


--
-- Name: staff_finalize_creation(uuid, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_finalize_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_operation private.staff_provisioning; v_branch uuid; v_role public.app_role;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_operation from private.staff_provisioning where id = p_request_key for update;
  if v_operation.id is null or p_claim_token is null or v_operation.owner_profile_id <> v_owner or v_operation.workspace_id <> p_workspace_id
    or v_operation.claim_token <> p_claim_token then
    raise exception 'STAFF_REQUEST_CONFLICT' using errcode = '42501'; end if;
  if v_operation.state = 'CREATED' then return private.staff_account_summary(v_operation.target_profile_id); end if;
  if v_operation.claim_expires_at <= clock_timestamp() then
    raise exception 'STAFF_REQUEST_CONFLICT' using errcode = '40001'; end if;
  if v_operation.state <> 'RESERVED' or not exists (
    select 1 from auth.users u where u.id = v_operation.target_auth_user_id and lower(u.email) = v_operation.email
      and u.is_anonymous is false and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'sejukops_staff_operation' = v_operation.id::text
  ) then raise exception 'STAFF_AUTH_NOT_READY' using errcode = '42501'; end if;
  v_role := (v_operation.input->>'role')::public.app_role;
  if v_role = 'TECHNICIAN' then
    select id into v_branch from public.workspace_branches where workspace_id = p_workspace_id
      and code = v_operation.input->>'branchCode' and active for share;
    if v_branch is null then raise exception 'STAFF_BRANCH_INVALID' using errcode = '22023'; end if;
  end if;
  insert into public.profiles(id,auth_user_id,display_name,role,platform_role,active,demo_principal)
    values(v_operation.target_profile_id,v_operation.target_auth_user_id,v_operation.input->>'name',v_role,'USER',true,false);
  insert into private.staff_accounts(profile_id,auth_user_id,workspace_id,email)
    values(v_operation.target_profile_id,v_operation.target_auth_user_id,p_workspace_id,v_operation.email);
  insert into public.workspace_memberships(workspace_id,profile_id,role,active)
    values(p_workspace_id,v_operation.target_profile_id,v_role,true);
  if v_role = 'TECHNICIAN' then
    insert into public.workspace_technicians(workspace_id,profile_id,branch_id,active)
      values(p_workspace_id,v_operation.target_profile_id,v_branch,true);
  end if;
  update private.staff_provisioning set state = 'CREATED',last_error_code = null,updated_at = clock_timestamp()
    where id = p_request_key;
  insert into public.audit_logs(id,actor_profile_id,event_type,idempotency_key,metadata_json)
    values(gen_random_uuid(),v_owner,'STAFF_ACCOUNT_CREATED',p_request_key::text,
      jsonb_build_object('workspaceId',p_workspace_id,'profileId',v_operation.target_profile_id,'role',v_role));
  return private.staff_account_summary(v_operation.target_profile_id);
end;
$$;


--
-- Name: staff_finalize_password_reset(uuid, uuid, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_finalize_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_request_key uuid, p_claim_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_profile public.profiles; v_staff private.staff_accounts;
  v_membership public.workspace_memberships; v_result jsonb;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_profile from public.profiles where id=p_profile_id for update;
  select * into v_staff from private.staff_accounts where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  select * into v_membership from public.workspace_memberships
    where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  if v_profile.id is null or v_staff.profile_id is null or v_membership.profile_id is null then
    raise exception 'STAFF_WORKSPACE_FORBIDDEN' using errcode='42501';
  end if;
  v_result := private.staff_password_reset_reconcile(p_request_key,v_owner,p_workspace_id,p_profile_id,p_claim_token,true);
  if v_result->>'state'<>'RESET' then
    raise exception 'STAFF_AUTH_NOT_READY' using errcode='42501';
  end if;
  return v_result->'account';
end;
$$;


--
-- Name: staff_finish_import_batch(uuid, uuid, uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_finish_import_batch(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_claim_token uuid, p_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_owner uuid; v_import private.staff_imports; v_result jsonb; v_row private.staff_import_rows;
  v_operation private.staff_provisioning; v_seen int[] := '{}';
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_import from private.staff_imports where id=p_import_id for update;
  if v_import.id is null or v_import.owner_profile_id <> v_owner or v_import.workspace_id <> p_workspace_id
    or p_claim_token is null or v_import.claim_token is distinct from p_claim_token
    or v_import.claim_expires_at <= clock_timestamp() then raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)>10 then
    raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result) is distinct from 'object' or (v_result-array['row','status','profileId','errorCode']) <> '{}'::jsonb
      or not (v_result ?& array['row','status'])
      or coalesce(v_result->>'row','') !~ '^[0-9]{1,4}$' or coalesce(v_result->>'status','') not in ('CREATED','ALREADY_CREATED','FAILED')
      or not ((v_result->>'row')::int=any(v_import.claimed_rows))
      or (v_result->>'row')::int=any(v_seen) then raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
    v_seen := array_append(v_seen,(v_result->>'row')::int);
    select * into v_row from private.staff_import_rows where import_id=p_import_id and row_number=(v_result->>'row')::int for update;
    if v_row.import_id is null or v_row.state <> 'PENDING' then raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505'; end if;
    if v_result->>'status' in ('CREATED','ALREADY_CREATED') then
      select * into v_operation from private.staff_provisioning where id=v_row.operation_id;
      if v_operation.id is null or v_operation.state <> 'CREATED' or v_operation.owner_profile_id <> v_owner
        or v_operation.workspace_id <> p_workspace_id or v_operation.input <> v_row.input
        or v_result->>'profileId' is distinct from v_operation.target_profile_id::text then
        raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505'; end if;
      update private.staff_import_rows set state=v_result->>'status',profile_id=v_operation.target_profile_id,error_code=null
        where import_id=p_import_id and row_number=v_row.row_number;
    else
      if coalesce(v_result->>'errorCode','') not in ('STAFF_CONFLICT','STAFF_INVALID_INPUT','STAFF_UNAVAILABLE') then
        raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
      update private.staff_import_rows set state='FAILED',error_code=v_result->>'errorCode' where import_id=p_import_id and row_number=v_row.row_number;
    end if;
  end loop;
  update private.staff_imports set claim_token=null,claim_expires_at=null,claimed_rows=null where id=p_import_id;
  return jsonb_build_object('complete',not exists(select 1 from private.staff_import_rows where import_id=p_import_id and state='PENDING'),
    'results',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('row',r.row_number,'status',r.state,
      'profileId',r.profile_id,'error',case when r.state='FAILED' then
      case r.error_code when 'STAFF_CONFLICT' then 'Account conflict; refresh and retry failed rows.'
        when 'STAFF_INVALID_INPUT' then 'Role or branch is no longer available.' else 'Creation could not finish; retry failed rows.' end end)) order by r.row_number)
      from private.staff_import_rows r where r.import_id=p_import_id and r.state<>'PENDING'),'[]'::jsonb));
end;
$_$;


--
-- Name: staff_issue_password_claim(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_issue_password_claim(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile_id uuid; v_staff private.staff_accounts; v_claim private.staff_password_claims;
  v_fingerprint text; v_now timestamptz;
begin
  select id into v_profile_id from public.profiles where auth_user_id=p_auth_user_id for update;
  select * into v_staff from private.staff_accounts where profile_id=v_profile_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision<>p_expected_revision
    or not private.staff_actor_ready(p_auth_user_id,v_staff.workspace_id,p_actor_session_id,true,true) then
    raise exception 'STAFF_PASSWORD_CLAIM_FORBIDDEN' using errcode='42501'; end if;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_fingerprint is null then raise exception 'STAFF_PASSWORD_CLAIM_FORBIDDEN' using errcode='42501'; end if;
  v_now := clock_timestamp();
  -- Bound retained state; a claim can be used only within its own 90-second window.
  delete from private.staff_password_claims where expires_at<=clock_timestamp();
  insert into private.staff_password_claims(profile_id,auth_user_id,auth_revision,auth_password_fingerprint,
    original_session_id,created_at,expires_at)
  values(v_profile_id,p_auth_user_id,p_expected_revision,v_fingerprint,p_actor_session_id,v_now,v_now+interval '90 seconds')
  returning * into v_claim;
  return jsonb_build_object('claimId',v_claim.id,'expiresAt',v_claim.expires_at);
end;
$$;


--
-- Name: staff_list(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_list(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(private.staff_account_summary(s.profile_id) order by s.email)
    from private.staff_accounts s where s.workspace_id = p_workspace_id),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('code',b.code,'name',b.name) order by b.code)
      from public.workspace_branches b where b.workspace_id = p_workspace_id and b.active),'[]'::jsonb));
end;
$$;


--
-- Name: staff_preview_import(uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_preview_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_owner uuid; v_id uuid := gen_random_uuid(); v_expires timestamptz := clock_timestamp()+interval '30 minutes';
  v_row jsonb; v_input jsonb; v_error text; v_rows jsonb := '[]'::jsonb; v_invalid int := 0;
  v_seen_rows int[] := '{}'; v_seen_emails text[] := '{}';
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_input := v_row->'input';
    if jsonb_typeof(v_row) is distinct from 'object' or (v_row-array['row','input']) <> '{}'::jsonb
      or not (v_row ?& array['row','input']) or coalesce(v_row->>'row','') !~ '^[0-9]{1,4}$'
      or (v_row->>'row')::int not between 2 and 1001
      or not private.staff_import_input_valid(v_input)
      or (v_row->>'row')::int = any(v_seen_rows) or v_input->>'email' = any(v_seen_emails) then
      raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
    v_seen_rows := array_append(v_seen_rows,(v_row->>'row')::int);
    v_seen_emails := array_append(v_seen_emails,v_input->>'email');
    v_error := null;
    if v_input->>'role' = 'TECHNICIAN' and not exists(select 1 from public.workspace_branches b
      where b.workspace_id=p_workspace_id and b.code=v_input->>'branchCode' and b.active) then
      v_error := 'Choose an active branch in this workspace.';
    elsif exists(select 1 from auth.users u where lower(u.email)=v_input->>'email')
      or exists(select 1 from private.staff_provisioning p where p.email=v_input->>'email') then
      v_error := 'This email is already in use or reserved; imports only create new accounts.';
    end if;
    if v_error is not null then v_invalid := v_invalid+1; end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('row',(v_row->>'row')::int,'input',v_input,
      'errors',case when v_error is null then '[]'::jsonb else jsonb_build_array(v_error) end));
  end loop;
  -- An invalid preview cannot ever be confirmed. Its ID is only a display token.
  if v_invalid = 0 then
    insert into private.staff_imports(id,owner_profile_id,workspace_id,expires_at) values(v_id,v_owner,p_workspace_id,v_expires);
    insert into private.staff_import_rows(import_id,row_number,input)
      select v_id,(value->>'row')::int,value->'input' from jsonb_array_elements(p_rows);
  end if;
  return jsonb_build_object('importId',v_id,'expiresAt',v_expires,'rows',v_rows,
    'validCount',jsonb_array_length(p_rows)-v_invalid,'invalidCount',v_invalid);
end;
$_$;


--
-- Name: staff_reserve_creation(uuid, uuid, uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_reserve_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_input jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_operation private.staff_provisioning; v_email text := p_input->>'email';
  v_hash text := encode(extensions.digest(p_input::text,'sha256'),'hex');
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  if p_request_key is null or not private.staff_input_valid(p_input,v_email)
    or v_email <> lower(btrim(v_email)) then
    raise exception 'STAFF_INVALID_INPUT' using errcode = '22023'; end if;
  if p_input->>'role' = 'TECHNICIAN' then
    perform 1 from public.workspace_branches b where b.workspace_id = p_workspace_id
      and b.code = p_input->>'branchCode' and b.active for share;
    if not found then raise exception 'STAFF_BRANCH_INVALID' using errcode = '22023'; end if;
  end if;
  -- A normalized email reservation serializes different keys without a workspace leak.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-email:' || v_email,0));
  select * into v_operation from private.staff_provisioning where id = p_request_key for update;
  if v_operation.id is not null then
    if v_operation.owner_profile_id <> v_owner or v_operation.workspace_id <> p_workspace_id
      or v_operation.input_hash <> v_hash or v_operation.input <> p_input then
      raise exception 'STAFF_REQUEST_CONFLICT' using errcode = '23505'; end if;
    if v_operation.state = 'CREATED' then
      return jsonb_build_object('state','CREATED','account',private.staff_account_summary(v_operation.target_profile_id));
    end if;
    if v_operation.state = 'RESERVED' and v_operation.claim_expires_at > clock_timestamp() then
      raise exception 'STAFF_BUSY' using errcode = '55P03'; end if;
    update private.staff_provisioning set state = 'RESERVED',claim_token = gen_random_uuid(),
      claim_expires_at = clock_timestamp()+interval '2 minutes',last_error_code = null,updated_at = clock_timestamp()
      where id = p_request_key returning * into v_operation;
  else
    if exists (select 1 from private.staff_provisioning where email = v_email)
      or exists (select 1 from auth.users where lower(email) = v_email) then
      raise exception 'STAFF_EMAIL_CONFLICT' using errcode = '23505'; end if;
    insert into private.staff_provisioning(id,owner_profile_id,workspace_id,input_hash,email,
      target_auth_user_id,target_profile_id,input,claim_expires_at)
      values(p_request_key,v_owner,p_workspace_id,v_hash,v_email,gen_random_uuid(),gen_random_uuid(),
        p_input,clock_timestamp()+interval '2 minutes') returning * into v_operation;
  end if;
  return jsonb_build_object('state','RESERVED','operationId',v_operation.id,'claimToken',v_operation.claim_token,
    'targetAuthUserId',v_operation.target_auth_user_id,'targetProfileId',v_operation.target_profile_id);
end;
$$;


--
-- Name: staff_reserve_password_reset(uuid, uuid, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_reserve_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_request_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_profile public.profiles; v_staff private.staff_accounts;
  v_membership public.workspace_memberships; v_operation private.staff_password_resets;
  v_reconciled jsonb; v_fingerprint text; v_reset_revision uuid;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  if p_request_key is null or p_profile_id is null or p_expected_revision is null then
    raise exception 'STAFF_INVALID_INPUT' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-password-reset:'||p_request_key::text,0));
  select * into v_profile from public.profiles where id=p_profile_id for update;
  select * into v_staff from private.staff_accounts where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  select * into v_membership from public.workspace_memberships
    where profile_id=p_profile_id and workspace_id=p_workspace_id for update;
  if v_profile.id is null or v_staff.profile_id is null or v_membership.profile_id is null
    or v_profile.auth_user_id is distinct from v_staff.auth_user_id
    or v_profile.platform_role<>'USER' or v_profile.demo_principal then
    raise exception 'STAFF_WORKSPACE_FORBIDDEN' using errcode='42501';
  end if;
  select * into v_operation from private.staff_password_resets where id=p_request_key;
  if v_operation.id is not null then
    if v_operation.owner_profile_id<>v_owner or v_operation.workspace_id<>p_workspace_id
      or v_operation.profile_id<>p_profile_id or v_operation.auth_user_id<>v_staff.auth_user_id
      or v_operation.expected_revision<>p_expected_revision then
      raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505';
    end if;
    v_reconciled := private.staff_password_reset_reconcile(p_request_key,v_owner,p_workspace_id,p_profile_id);
    if v_reconciled->>'state'='RESET' then
      return jsonb_build_object('state','RESET','account',v_reconciled->'account');
    end if;
    select * into v_operation from private.staff_password_resets where id=p_request_key for update;
    if v_operation.claim_expires_at>clock_timestamp() then
      raise exception 'STAFF_BUSY' using errcode='55P03';
    end if;
    update private.staff_password_resets set claim_token=gen_random_uuid(),
      claim_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
      where id=p_request_key returning * into v_operation;
    return jsonb_build_object('state','RESERVED','operationId',v_operation.id,'claimToken',v_operation.claim_token,
      'targetAuthUserId',v_operation.auth_user_id,'targetProfileId',v_operation.profile_id,
      'resetRevision',v_operation.reset_revision);
  end if;
  if v_staff.auth_revision<>p_expected_revision then
    raise exception 'STAFF_STALE_ACCOUNT' using errcode='40001';
  end if;
  v_fingerprint := private.staff_auth_password_fingerprint(v_staff.auth_user_id);
  if v_fingerprint is null then raise exception 'STAFF_AUTH_PASSWORD_UNAVAILABLE' using errcode='42501'; end if;
  v_reset_revision := gen_random_uuid();
  insert into private.staff_password_resets(id,owner_profile_id,workspace_id,profile_id,auth_user_id,
    expected_revision,reset_revision,initial_fingerprint,claim_expires_at)
    values(p_request_key,v_owner,p_workspace_id,p_profile_id,v_staff.auth_user_id,p_expected_revision,
      v_reset_revision,v_fingerprint,clock_timestamp()+interval '2 minutes') returning * into v_operation;
  -- Revoke old sessions and claims before any Auth mutation. If Auth is uncertain,
  -- the account remains blocked until this exact operation is reconciled or retried.
  update private.staff_accounts set password_change_required=true,auth_revision=v_reset_revision,
    sessions_valid_after=clock_timestamp(),updated_at=clock_timestamp() where profile_id=p_profile_id;
  delete from private.staff_password_claims where profile_id=p_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,idempotency_key,metadata_json)
    values(gen_random_uuid(),v_owner,'STAFF_PASSWORD_RESET_RESERVED',p_request_key::text||':reserved',
      jsonb_build_object('workspaceId',p_workspace_id,'profileId',p_profile_id));
  return jsonb_build_object('state','RESERVED','operationId',v_operation.id,'claimToken',v_operation.claim_token,
    'targetAuthUserId',v_operation.auth_user_id,'targetProfileId',v_operation.profile_id,
    'resetRevision',v_operation.reset_revision);
end;
$$;


--
-- Name: staff_session_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_session_status() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_profile public.profiles; v_staff private.staff_accounts;
  v_auth_user_id uuid := (select auth.uid()); v_session_id uuid := private.staff_signed_session_id();
begin
  if v_auth_user_id is null then raise exception 'STAFF_UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where auth_user_id = v_auth_user_id;
  if v_profile.id is null then
    return jsonb_build_object('isManaged',false,'passwordChangeRequired',false,
      'sessionAllowed',false,'authRevision',null,'sessionId',v_session_id);
  end if;
  select * into v_staff from private.staff_accounts where profile_id = v_profile.id;
  return jsonb_build_object('isManaged',v_staff.profile_id is not null,
    'passwordChangeRequired',case when v_staff.profile_id is not null then
      v_staff.password_change_required or not coalesce(private.staff_password_current(v_profile.id),false) else false end,
    'sessionAllowed',private.staff_actor_ready(v_auth_user_id,v_staff.workspace_id,v_session_id,false,true),
    'authRevision',v_staff.auth_revision,'sessionId',v_session_id);
end;
$$;


--
-- Name: staff_update_account(uuid, uuid, uuid, uuid, uuid, public.app_role, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_update_account(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_role public.app_role, p_branch_code text, p_active boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_owner uuid; v_staff private.staff_accounts; v_branch uuid;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  perform 1 from public.profiles where id = p_profile_id for update;
  select * into v_staff from private.staff_accounts where profile_id = p_profile_id and workspace_id = p_workspace_id for update;
  if v_staff.profile_id is null or p_expected_revision is null or v_staff.auth_revision <> p_expected_revision then
    raise exception 'STAFF_STALE_ACCOUNT' using errcode = '40001'; end if;
  if p_role is null or p_active is null or (p_role <> 'TECHNICIAN' and p_branch_code is not null) then
    raise exception 'STAFF_INVALID_INPUT' using errcode = '22023'; end if;
  if p_role = 'TECHNICIAN' then
    select id into v_branch from public.workspace_branches where workspace_id = p_workspace_id and active and code = p_branch_code for share;
    if v_branch is null then raise exception 'STAFF_BRANCH_INVALID' using errcode = '22023'; end if;
    if exists (select 1 from public.workspace_technicians t join public.workspace_orders o
      on o.workspace_id = t.workspace_id and o.assigned_technician_id = t.id
      where t.workspace_id = p_workspace_id and t.profile_id = p_profile_id and t.branch_id <> v_branch) then
      raise exception 'STAFF_BRANCH_IN_USE' using errcode = '23514'; end if;
  end if;
  update public.workspace_memberships set role = p_role,active = p_active,updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and profile_id = p_profile_id;
  if not found then raise exception 'STAFF_MEMBERSHIP_MISSING' using errcode = '23514'; end if;
  update public.profiles set active = p_active,role = p_role,updated_at = clock_timestamp() where id = p_profile_id;
  if p_role = 'TECHNICIAN' then
    insert into public.workspace_technicians(workspace_id,profile_id,branch_id,active)
      values(p_workspace_id,p_profile_id,v_branch,p_active)
      on conflict(workspace_id,profile_id) do update set branch_id = excluded.branch_id,active = excluded.active,updated_at = clock_timestamp();
  else
    update public.workspace_technicians set active = false,updated_at = clock_timestamp()
      where workspace_id = p_workspace_id and profile_id = p_profile_id;
  end if;
  update private.staff_accounts set auth_revision = gen_random_uuid(),sessions_valid_after = clock_timestamp(),updated_at = clock_timestamp()
    where profile_id = p_profile_id;
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    values(gen_random_uuid(),v_owner,'STAFF_ACCOUNT_UPDATED',jsonb_build_object('workspaceId',p_workspace_id,
      'profileId',p_profile_id,'role',p_role,'active',p_active));
  return private.staff_account_summary(p_profile_id);
end;
$$;


--
-- Name: workspace_assignment_proposal_approve(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid DEFAULT NULL::uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_assignment_proposal_approve(
    p_workspace_id, p_proposal_id, p_approver_auth_user_id, p_actor_session_id
  );
$$;


--
-- Name: workspace_assignment_proposal_create(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_assignment_proposal_create(
    p_workspace_id, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at, p_idempotency_key
  );
$$;


--
-- Name: workspace_assignment_proposal_create_mcp(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_assignment_proposal_create_mcp(
    p_workspace_id, p_order_id, p_technician_id, p_expected_updated_at,
    p_scheduled_at, p_idempotency_key, p_initiator_auth_user_id
  );
$$;


--
-- Name: workspace_assignment_proposal_execute(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) RETURNS public.workspace_assignment_proposals
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_assignment_proposal_execute(p_workspace_id, p_proposal_id);
$$;


--
-- Name: workspace_order_assign(uuid, bigint, uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_assign_current(
    p_workspace_id, p_expected_generation, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at
  );
$$;


--
-- Name: workspace_order_assign(uuid, bigint, uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_manual_assign(
    p_workspace_id, p_expected_generation, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at, p_guest_visit_id, p_guest_token_hash);
$$;


--
-- Name: workspace_order_create(uuid, bigint, text, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_create_current(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_id, p_problem_description, p_service_type
  );
$$;


--
-- Name: workspace_order_create(uuid, bigint, text, uuid, uuid, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_manual_create(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_id, p_problem_description, p_service_type,
    p_guest_visit_id, p_guest_token_hash);
$$;


--
-- Name: workspace_order_create_with_customer(uuid, bigint, text, uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_create_with_customer(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_name, p_customer_phone, p_customer_address,
    p_problem_description, p_service_type
  );
$$;


--
-- Name: workspace_order_create_with_customer(uuid, bigint, text, uuid, text, text, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_manual_create_with_customer(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_name, p_customer_phone, p_customer_address,
    p_problem_description, p_service_type, p_guest_visit_id, p_guest_token_hash);
$$;


--
-- Name: workspace_order_manager_reschedule(uuid, bigint, uuid, timestamp with time zone, timestamp with time zone, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_manager_reschedule(
    p_workspace_id, p_expected_generation, p_order_id,
    p_expected_updated_at, p_scheduled_at, p_guest_visit_id, p_guest_token_hash
  );
$$;


--
-- Name: workspace_order_technician_transition(uuid, bigint, uuid, timestamp with time zone, public.service_order_status, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) RETURNS public.workspace_orders
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.workspace_order_technician_transition(
    p_workspace_id, p_expected_generation, p_order_id,
    p_expected_updated_at, p_next_status, p_guest_visit_id, p_guest_token_hash
  );
$$;


--
-- Name: guest_ai_budget_counter; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.guest_ai_budget_counter (
    usage_day date NOT NULL,
    attempt_count integer NOT NULL,
    CONSTRAINT guest_ai_budget_counter_attempt_count_check CHECK ((attempt_count > 0))
);


--
-- Name: guest_ai_budget_policy; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.guest_ai_budget_policy (
    singleton boolean DEFAULT true NOT NULL,
    daily_limit integer NOT NULL,
    CONSTRAINT guest_ai_budget_policy_daily_limit_check CHECK (((daily_limit >= 1) AND (daily_limit <= 1000))),
    CONSTRAINT guest_ai_budget_policy_singleton_check CHECK (singleton)
);


--
-- Name: knowledge_pdf_stage_attestations; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.knowledge_pdf_stage_attestations (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_auth_user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    generation bigint NOT NULL,
    document_id uuid NOT NULL,
    pages_sha256 text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT knowledge_pdf_stage_attestations_generation_check CHECK ((generation > 0)),
    CONSTRAINT knowledge_pdf_stage_attestations_pages_sha256_check CHECK ((pages_sha256 ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: owner_previews; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.owner_previews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    owner_profile_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    role public.app_role NOT NULL,
    effective_employee_profile_id uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT owner_previews_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '01:00:00'::interval)))),
    CONSTRAINT owner_previews_role_check CHECK ((role = ANY (ARRAY['ADMIN'::public.app_role, 'MANAGER'::public.app_role, 'TECHNICIAN'::public.app_role])))
);


--
-- Name: staff_accounts; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.staff_accounts (
    profile_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    password_change_required boolean DEFAULT true NOT NULL,
    auth_revision uuid DEFAULT gen_random_uuid() NOT NULL,
    sessions_valid_after timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_password_fingerprint text,
    CONSTRAINT staff_accounts_auth_password_fingerprint_check CHECK (((auth_password_fingerprint IS NULL) OR (auth_password_fingerprint ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT staff_accounts_email_check CHECK (((email = lower(btrim(email))) AND ((char_length(email) >= 3) AND (char_length(email) <= 254)) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+$'::text)))
);


--
-- Name: staff_import_rows; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.staff_import_rows (
    import_id uuid NOT NULL,
    row_number integer NOT NULL,
    operation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    input jsonb NOT NULL,
    state text DEFAULT 'PENDING'::text NOT NULL,
    profile_id uuid,
    error_code text,
    CONSTRAINT staff_import_rows_error_code_check CHECK ((error_code = ANY (ARRAY['STAFF_CONFLICT'::text, 'STAFF_INVALID_INPUT'::text, 'STAFF_UNAVAILABLE'::text]))),
    CONSTRAINT staff_import_rows_input_check CHECK (private.staff_import_input_valid(input)),
    CONSTRAINT staff_import_rows_row_number_check CHECK (((row_number >= 2) AND (row_number <= 1001))),
    CONSTRAINT staff_import_rows_state_check CHECK ((state = ANY (ARRAY['PENDING'::text, 'CREATED'::text, 'ALREADY_CREATED'::text, 'FAILED'::text])))
);


--
-- Name: staff_imports; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.staff_imports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_profile_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    expires_at timestamp with time zone DEFAULT (clock_timestamp() + '00:30:00'::interval) NOT NULL,
    confirmed_at timestamp with time zone,
    claim_token uuid,
    claim_expires_at timestamp with time zone,
    claimed_rows integer[],
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: staff_password_claims; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.staff_password_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    auth_revision uuid NOT NULL,
    auth_password_fingerprint text NOT NULL,
    original_session_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT staff_password_claims_auth_password_fingerprint_check CHECK ((auth_password_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT staff_password_claims_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:01:30'::interval))))
);


--
-- Name: staff_password_resets; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.staff_password_resets (
    id uuid NOT NULL,
    owner_profile_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    expected_revision uuid NOT NULL,
    reset_revision uuid NOT NULL,
    initial_fingerprint text NOT NULL,
    claim_token uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_expires_at timestamp with time zone NOT NULL,
    state text DEFAULT 'RESERVED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT staff_password_resets_check CHECK ((claim_expires_at > created_at)),
    CONSTRAINT staff_password_resets_initial_fingerprint_check CHECK ((initial_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT staff_password_resets_state_check CHECK ((state = ANY (ARRAY['RESERVED'::text, 'RESET'::text])))
);


--
-- Name: staff_provisioning; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.staff_provisioning (
    id uuid NOT NULL,
    owner_profile_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    input_hash text NOT NULL,
    email text NOT NULL,
    target_auth_user_id uuid NOT NULL,
    target_profile_id uuid NOT NULL,
    input jsonb NOT NULL,
    state text DEFAULT 'RESERVED'::text NOT NULL,
    claim_token uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_expires_at timestamp with time zone NOT NULL,
    last_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_provisioning_check CHECK (private.staff_input_valid(input, email)),
    CONSTRAINT staff_provisioning_check1 CHECK ((claim_expires_at > created_at)),
    CONSTRAINT staff_provisioning_email_check CHECK (((email = lower(btrim(email))) AND ((char_length(email) >= 3) AND (char_length(email) <= 254)) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+$'::text))),
    CONSTRAINT staff_provisioning_input_hash_check CHECK ((input_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT staff_provisioning_last_error_code_check CHECK ((last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)),
    CONSTRAINT staff_provisioning_state_check CHECK ((state = ANY (ARRAY['RESERVED'::text, 'CREATED'::text, 'FAILED'::text])))
);


--
-- Name: workspace_order_activity_audit; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.workspace_order_activity_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    workspace_generation bigint NOT NULL,
    order_id uuid NOT NULL,
    actor_profile_id uuid NOT NULL,
    guest_visit_id uuid,
    source text NOT NULL,
    from_status public.service_order_status NOT NULL,
    to_status public.service_order_status NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT workspace_order_activity_audit_source_check CHECK ((source = ANY (ARRAY['ACCOUNT'::text, 'GUEST'::text]))),
    CONSTRAINT workspace_order_activity_audit_workspace_generation_check CHECK ((workspace_generation > 0)),
    CONSTRAINT workspace_order_activity_guest_source CHECK ((((source = 'GUEST'::text) AND (guest_visit_id IS NOT NULL)) OR ((source = 'ACCOUNT'::text) AND (guest_visit_id IS NULL))))
);


--
-- Name: workspace_order_manual_audit; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.workspace_order_manual_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    workspace_generation bigint NOT NULL,
    order_id uuid NOT NULL,
    actor_profile_id uuid NOT NULL,
    guest_visit_id uuid,
    source text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT workspace_order_manual_audit_event_type_check CHECK ((event_type = ANY (ARRAY['CREATE'::text, 'ASSIGN'::text]))),
    CONSTRAINT workspace_order_manual_audit_source CHECK ((((source = 'GUEST'::text) AND (guest_visit_id IS NOT NULL)) OR ((source = 'ACCOUNT'::text) AND (guest_visit_id IS NULL)))),
    CONSTRAINT workspace_order_manual_audit_source_check CHECK ((source = ANY (ARRAY['ACCOUNT'::text, 'GUEST'::text]))),
    CONSTRAINT workspace_order_manual_audit_workspace_generation_check CHECK ((workspace_generation > 0))
);


--
-- Name: workspace_order_schedule_audit; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.workspace_order_schedule_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    workspace_generation bigint NOT NULL,
    order_id uuid NOT NULL,
    actor_profile_id uuid NOT NULL,
    guest_visit_id uuid,
    source text NOT NULL,
    from_scheduled_at timestamp with time zone,
    to_scheduled_at timestamp with time zone NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT workspace_order_schedule_audit_guest_source CHECK ((((source = 'GUEST'::text) AND (guest_visit_id IS NOT NULL)) OR ((source = 'ACCOUNT'::text) AND (guest_visit_id IS NULL)))),
    CONSTRAINT workspace_order_schedule_audit_source_check CHECK ((source = ANY (ARRAY['ACCOUNT'::text, 'GUEST'::text]))),
    CONSTRAINT workspace_order_schedule_audit_workspace_generation_check CHECK ((workspace_generation > 0))
);


--
-- Name: ai_provider_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_provider_configs (
    id uuid NOT NULL,
    name text NOT NULL,
    provider_type text NOT NULL,
    base_url text,
    model text NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    encrypted_api_key text,
    key_last4 text,
    status public.ai_provider_status DEFAULT 'DISABLED'::public.ai_provider_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    api_key_iv text,
    api_key_auth_tag text,
    encryption_version smallint,
    create_request_key uuid,
    create_payload_signature text,
    CONSTRAINT ai_provider_base_url_present CHECK (((base_url IS NOT NULL) AND (btrim(base_url) <> ''::text))),
    CONSTRAINT ai_provider_capabilities_complete CHECK (((jsonb_typeof(capabilities) = 'object'::text) AND (jsonb_typeof((capabilities -> 'text'::text)) = 'boolean'::text) AND (jsonb_typeof((capabilities -> 'vision'::text)) = 'boolean'::text) AND (jsonb_typeof((capabilities -> 'toolCalling'::text)) = 'boolean'::text) AND (jsonb_typeof((capabilities -> 'structuredOutput'::text)) = 'boolean'::text) AND ((capabilities - ARRAY['text'::text, 'vision'::text, 'toolCalling'::text, 'structuredOutput'::text]) = '{}'::jsonb))),
    CONSTRAINT ai_provider_configs_key_last4_check CHECK (((key_last4 IS NULL) OR (length(key_last4) = 4))),
    CONSTRAINT ai_provider_create_idempotency_complete CHECK ((((create_request_key IS NULL) AND (create_payload_signature IS NULL)) OR ((create_request_key IS NOT NULL) AND (create_payload_signature ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT ai_provider_encrypted_credential_complete CHECK ((((encrypted_api_key IS NULL) AND (api_key_iv IS NULL) AND (api_key_auth_tag IS NULL) AND (encryption_version IS NULL) AND (key_last4 IS NULL)) OR ((encrypted_api_key IS NOT NULL) AND (api_key_iv IS NOT NULL) AND (api_key_auth_tag IS NOT NULL) AND (encryption_version = 1) AND (key_last4 IS NOT NULL)))),
    CONSTRAINT ai_provider_type_supported CHECK ((provider_type = 'OPENAI_COMPATIBLE'::text))
);


--
-- Name: ai_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_settings (
    id uuid NOT NULL,
    routing_mode public.ai_routing_mode DEFAULT 'SINGLE_MODEL'::public.ai_routing_mode NOT NULL,
    default_provider_config_id uuid,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_settings_singleton CHECK ((id = '00000000-0000-4000-8000-00000000a100'::uuid))
);


--
-- Name: ai_task_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_task_routes (
    id uuid NOT NULL,
    task_type public.ai_task_type NOT NULL,
    provider_config_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid NOT NULL,
    actor_profile_id uuid,
    event_type text NOT NULL,
    idempotency_key text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_event_type_check CHECK ((btrim(event_type) <> ''::text))
);


--
-- Name: guest_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    workspace_id uuid NOT NULL,
    persona public.app_role NOT NULL,
    demo_generation bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guest_visits_check CHECK ((expires_at > created_at)),
    CONSTRAINT guest_visits_demo_generation_check CHECK ((demo_generation > 0)),
    CONSTRAINT guest_visits_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: knowledge_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_chunks (
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    version_id uuid NOT NULL,
    ordinal integer NOT NULL,
    section_label text NOT NULL,
    content text NOT NULL,
    page_no integer DEFAULT 1 NOT NULL,
    CONSTRAINT knowledge_chunks_content_check CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 2000))),
    CONSTRAINT knowledge_chunks_ordinal_check CHECK (((ordinal >= 1) AND (ordinal <= 64))),
    CONSTRAINT knowledge_chunks_page_no_check CHECK (((page_no >= 1) AND (page_no <= 20))),
    CONSTRAINT knowledge_chunks_section_label_check CHECK (((char_length(btrim(section_label)) >= 1) AND (char_length(btrim(section_label)) <= 80)))
);


--
-- Name: knowledge_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_documents (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    generation bigint NOT NULL,
    title text NOT NULL,
    source_label text NOT NULL,
    created_by_profile_id uuid NOT NULL,
    state public.knowledge_document_state DEFAULT 'DRAFT'::public.knowledge_document_state NOT NULL,
    published_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_document_publication_consistent CHECK ((((state = 'DRAFT'::public.knowledge_document_state) AND (published_version_id IS NULL)) OR ((state = ANY (ARRAY['PUBLISHED'::public.knowledge_document_state, 'ARCHIVED'::public.knowledge_document_state])) AND (published_version_id IS NOT NULL)))),
    CONSTRAINT knowledge_documents_generation_check CHECK ((generation > 0)),
    CONSTRAINT knowledge_documents_source_label_check CHECK (((char_length(btrim(source_label)) >= 1) AND (char_length(btrim(source_label)) <= 160))),
    CONSTRAINT knowledge_documents_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160)))
);


--
-- Name: knowledge_version_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_version_pages (
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    version_id uuid NOT NULL,
    page_no integer NOT NULL,
    content text NOT NULL,
    CONSTRAINT knowledge_version_pages_content_check CHECK ((char_length(content) <= 100000)),
    CONSTRAINT knowledge_version_pages_page_no_check CHECK (((page_no >= 1) AND (page_no <= 20)))
);


--
-- Name: knowledge_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_versions (
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_no integer NOT NULL,
    generation bigint NOT NULL,
    source_text text NOT NULL,
    sha256 text NOT NULL,
    index_state public.knowledge_index_state DEFAULT 'PENDING'::public.knowledge_index_state NOT NULL,
    index_error text,
    chunk_count integer DEFAULT 0 NOT NULL,
    created_by_profile_id uuid NOT NULL,
    reviewed_by_profile_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_kind text DEFAULT 'TEXT'::text NOT NULL,
    index_token uuid,
    index_started_at timestamp with time zone,
    index_attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT knowledge_index_claim_pair CHECK ((((index_state = 'PROCESSING'::public.knowledge_index_state) = (index_token IS NOT NULL)) AND ((index_token IS NULL) = (index_started_at IS NULL)))),
    CONSTRAINT knowledge_review_pair CHECK (((reviewed_at IS NULL) = (reviewed_by_profile_id IS NULL))),
    CONSTRAINT knowledge_versions_chunk_count_check CHECK (((chunk_count >= 0) AND (chunk_count <= 64))),
    CONSTRAINT knowledge_versions_generation_check CHECK ((generation > 0)),
    CONSTRAINT knowledge_versions_index_attempts_check CHECK (((index_attempts >= 0) AND (index_attempts <= 10))),
    CONSTRAINT knowledge_versions_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT knowledge_versions_source_kind_check CHECK ((source_kind = ANY (ARRAY['TEXT'::text, 'PDF_TEXT'::text]))),
    CONSTRAINT knowledge_versions_source_text_check CHECK (((char_length(source_text) >= 1) AND (char_length(source_text) <= 100000))),
    CONSTRAINT knowledge_versions_version_no_check CHECK ((version_no > 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    auth_user_id uuid,
    display_name text NOT NULL,
    role public.app_role NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_role public.platform_role DEFAULT 'USER'::public.platform_role NOT NULL,
    demo_principal boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_demo_principal_not_platform_admin CHECK (((NOT demo_principal) OR (platform_role = 'USER'::public.platform_role))),
    CONSTRAINT profiles_display_name_check CHECK ((btrim(display_name) <> ''::text))
);


--
-- Name: workspace_assignment_proposal_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_assignment_proposal_audit (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_id uuid NOT NULL,
    initiator_profile_id uuid NOT NULL,
    approver_profile_id uuid,
    executor_profile_id uuid,
    event_type text NOT NULL,
    source_client text NOT NULL,
    target_order_id uuid NOT NULL,
    outcome text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_assignment_proposal_audit_event_type_check CHECK ((event_type = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'EXECUTED'::text, 'STALE'::text, 'EXPIRED'::text]))),
    CONSTRAINT workspace_assignment_proposal_audit_source_client_check CHECK ((source_client = ANY (ARRAY['WEB'::text, 'INTERNAL_AGENT'::text, 'MCP'::text])))
);


--
-- Name: workspace_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_branches (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_branches_code_check CHECK ((btrim(code) <> ''::text)),
    CONSTRAINT workspace_branches_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: workspace_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_customers (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_customers_address_check CHECK ((btrim(address) <> ''::text)),
    CONSTRAINT workspace_customers_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: workspace_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_memberships (
    workspace_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role public.app_role NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_technicians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_technicians (
    workspace_id uuid NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.workspace_kind NOT NULL,
    name text NOT NULL,
    generation bigint DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_generation_check CHECK ((generation > 0)),
    CONSTRAINT workspaces_name_check CHECK ((btrim(name) <> ''::text))
);


--
-- Name: guest_ai_budget_counter guest_ai_budget_counter_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.guest_ai_budget_counter
    ADD CONSTRAINT guest_ai_budget_counter_pkey PRIMARY KEY (usage_day);


--
-- Name: guest_ai_budget_policy guest_ai_budget_policy_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.guest_ai_budget_policy
    ADD CONSTRAINT guest_ai_budget_policy_pkey PRIMARY KEY (singleton);


--
-- Name: knowledge_pdf_stage_attestations knowledge_pdf_stage_attestations_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.knowledge_pdf_stage_attestations
    ADD CONSTRAINT knowledge_pdf_stage_attestations_pkey PRIMARY KEY (token);


--
-- Name: owner_previews owner_previews_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_pkey PRIMARY KEY (id);


--
-- Name: owner_previews owner_previews_session_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_session_id_key UNIQUE (session_id);


--
-- Name: staff_accounts staff_accounts_auth_user_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_accounts
    ADD CONSTRAINT staff_accounts_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: staff_accounts staff_accounts_email_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_accounts
    ADD CONSTRAINT staff_accounts_email_key UNIQUE (email);


--
-- Name: staff_accounts staff_accounts_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_accounts
    ADD CONSTRAINT staff_accounts_pkey PRIMARY KEY (profile_id);


--
-- Name: staff_import_rows staff_import_rows_operation_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_import_rows
    ADD CONSTRAINT staff_import_rows_operation_id_key UNIQUE (operation_id);


--
-- Name: staff_import_rows staff_import_rows_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_import_rows
    ADD CONSTRAINT staff_import_rows_pkey PRIMARY KEY (import_id, row_number);


--
-- Name: staff_imports staff_imports_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_imports
    ADD CONSTRAINT staff_imports_pkey PRIMARY KEY (id);


--
-- Name: staff_password_claims staff_password_claims_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_claims
    ADD CONSTRAINT staff_password_claims_pkey PRIMARY KEY (id);


--
-- Name: staff_password_resets staff_password_resets_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_resets
    ADD CONSTRAINT staff_password_resets_pkey PRIMARY KEY (id);


--
-- Name: staff_provisioning staff_provisioning_email_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_provisioning
    ADD CONSTRAINT staff_provisioning_email_key UNIQUE (email);


--
-- Name: staff_provisioning staff_provisioning_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_provisioning
    ADD CONSTRAINT staff_provisioning_pkey PRIMARY KEY (id);


--
-- Name: staff_provisioning staff_provisioning_target_auth_user_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_provisioning
    ADD CONSTRAINT staff_provisioning_target_auth_user_id_key UNIQUE (target_auth_user_id);


--
-- Name: staff_provisioning staff_provisioning_target_profile_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_provisioning
    ADD CONSTRAINT staff_provisioning_target_profile_id_key UNIQUE (target_profile_id);


--
-- Name: workspace_order_activity_audit workspace_order_activity_audit_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.workspace_order_activity_audit
    ADD CONSTRAINT workspace_order_activity_audit_pkey PRIMARY KEY (id);


--
-- Name: workspace_order_manual_audit workspace_order_manual_audit_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.workspace_order_manual_audit
    ADD CONSTRAINT workspace_order_manual_audit_pkey PRIMARY KEY (id);


--
-- Name: workspace_order_schedule_audit workspace_order_schedule_audit_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.workspace_order_schedule_audit
    ADD CONSTRAINT workspace_order_schedule_audit_pkey PRIMARY KEY (id);


--
-- Name: ai_provider_configs ai_provider_configs_create_request_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs
    ADD CONSTRAINT ai_provider_configs_create_request_key_key UNIQUE (create_request_key);


--
-- Name: ai_provider_configs ai_provider_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_configs
    ADD CONSTRAINT ai_provider_configs_pkey PRIMARY KEY (id);


--
-- Name: ai_settings ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);


--
-- Name: ai_task_routes ai_task_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_task_routes
    ADD CONSTRAINT ai_task_routes_pkey PRIMARY KEY (id);


--
-- Name: ai_task_routes ai_task_routes_task_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_task_routes
    ADD CONSTRAINT ai_task_routes_task_type_key UNIQUE (task_type);


--
-- Name: audit_logs audit_logs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: guest_visits guest_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_pkey PRIMARY KEY (id);


--
-- Name: guest_visits guest_visits_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_token_hash_key UNIQUE (token_hash);


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (workspace_id, document_id, version_id, ordinal);


--
-- Name: knowledge_documents knowledge_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: knowledge_version_pages knowledge_version_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_pages
    ADD CONSTRAINT knowledge_version_pages_pkey PRIMARY KEY (workspace_id, document_id, version_id, page_no);


--
-- Name: knowledge_versions knowledge_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_versions
    ADD CONSTRAINT knowledge_versions_pkey PRIMARY KEY (workspace_id, document_id, id);


--
-- Name: knowledge_versions knowledge_versions_workspace_id_document_id_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_versions
    ADD CONSTRAINT knowledge_versions_workspace_id_document_id_sha256_key UNIQUE (workspace_id, document_id, sha256);


--
-- Name: knowledge_versions knowledge_versions_workspace_id_document_id_version_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_versions
    ADD CONSTRAINT knowledge_versions_workspace_id_document_id_version_no_key UNIQUE (workspace_id, document_id, version_no);


--
-- Name: profiles profiles_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: workspace_assignment_proposal_audit workspace_assignment_proposal_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_assignment_proposal_audit
    ADD CONSTRAINT workspace_assignment_proposal_audit_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_assignment_proposals workspace_assignment_proposal_workspace_id_initiated_by_pro_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_assignment_proposals
    ADD CONSTRAINT workspace_assignment_proposal_workspace_id_initiated_by_pro_key UNIQUE (workspace_id, initiated_by_profile_id, idempotency_key);


--
-- Name: workspace_assignment_proposals workspace_assignment_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_assignment_proposals
    ADD CONSTRAINT workspace_assignment_proposals_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_branches workspace_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_branches
    ADD CONSTRAINT workspace_branches_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_branches workspace_branches_workspace_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_branches
    ADD CONSTRAINT workspace_branches_workspace_id_code_key UNIQUE (workspace_id, code);


--
-- Name: workspace_customers workspace_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_customers
    ADD CONSTRAINT workspace_customers_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_memberships workspace_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (workspace_id, profile_id);


--
-- Name: workspace_orders workspace_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_orders workspace_orders_workspace_id_order_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_workspace_id_order_no_key UNIQUE (workspace_id, order_no);


--
-- Name: workspace_technicians workspace_technicians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_technicians
    ADD CONSTRAINT workspace_technicians_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_technicians workspace_technicians_workspace_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_technicians
    ADD CONSTRAINT workspace_technicians_workspace_branch_id_key UNIQUE (workspace_id, branch_id, id);


--
-- Name: workspace_technicians workspace_technicians_workspace_id_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_technicians
    ADD CONSTRAINT workspace_technicians_workspace_id_profile_id_key UNIQUE (workspace_id, profile_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: owner_previews_actor_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX owner_previews_actor_idx ON private.owner_previews USING btree (auth_user_id, workspace_id);


--
-- Name: staff_import_email_unique; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX staff_import_email_unique ON private.staff_import_rows USING btree (import_id, ((input ->> 'email'::text)));


--
-- Name: staff_password_claims_expiry_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX staff_password_claims_expiry_idx ON private.staff_password_claims USING btree (expires_at);


--
-- Name: staff_password_resets_expiry_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX staff_password_resets_expiry_idx ON private.staff_password_resets USING btree (claim_expires_at) WHERE (state = 'RESERVED'::text);


--
-- Name: workspace_order_activity_scope_time_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX workspace_order_activity_scope_time_idx ON private.workspace_order_activity_audit USING btree (workspace_id, workspace_generation, occurred_at DESC);


--
-- Name: workspace_order_manual_audit_scope_time_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX workspace_order_manual_audit_scope_time_idx ON private.workspace_order_manual_audit USING btree (workspace_id, workspace_generation, occurred_at DESC);


--
-- Name: workspace_order_schedule_audit_scope_time_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX workspace_order_schedule_audit_scope_time_idx ON private.workspace_order_schedule_audit USING btree (workspace_id, workspace_generation, occurred_at DESC);


--
-- Name: guest_visits_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_visits_expiry_idx ON public.guest_visits USING btree (expires_at);


--
-- Name: guest_visits_workspace_generation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_visits_workspace_generation_idx ON public.guest_visits USING btree (workspace_id, demo_generation);


--
-- Name: knowledge_chunks_english_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_english_fts_idx ON public.knowledge_chunks USING gin (to_tsvector('english'::regconfig, content));


--
-- Name: knowledge_chunks_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_lookup_idx ON public.knowledge_chunks USING btree (workspace_id, document_id, version_id);


--
-- Name: knowledge_documents_creator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_documents_creator_idx ON public.knowledge_documents USING btree (workspace_id, created_by_profile_id, state);


--
-- Name: workspace_assignment_proposals_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_assignment_proposals_target_idx ON public.workspace_assignment_proposals USING btree (workspace_id, target_order_id, created_at DESC);


--
-- Name: workspace_memberships_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_memberships_profile_idx ON public.workspace_memberships USING btree (profile_id, active);


--
-- Name: workspace_orders_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_orders_customer_idx ON public.workspace_orders USING btree (workspace_id, customer_id, assigned_technician_id);


--
-- Name: workspace_orders_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_orders_status_idx ON public.workspace_orders USING btree (workspace_id, status, created_at DESC);


--
-- Name: workspace_orders_technician_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_orders_technician_idx ON public.workspace_orders USING btree (workspace_id, assigned_technician_id, scheduled_at);


--
-- Name: workspaces_one_demo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_one_demo_idx ON public.workspaces USING btree (kind) WHERE (kind = 'DEMO'::public.workspace_kind);


--
-- Name: workspaces_one_per_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_one_per_kind_idx ON public.workspaces USING btree (kind);


--
-- Name: staff_accounts staff_accounts_identity_guard; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER staff_accounts_identity_guard BEFORE INSERT OR UPDATE ON private.staff_accounts FOR EACH ROW EXECUTE FUNCTION private.staff_identity_guard();


--
-- Name: staff_accounts staff_initialize_password_fingerprint; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER staff_initialize_password_fingerprint AFTER INSERT ON private.staff_accounts FOR EACH ROW EXECUTE FUNCTION private.staff_initialize_password_fingerprint();


--
-- Name: ai_provider_configs ai_provider_configs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_provider_configs_set_updated_at BEFORE UPDATE ON public.ai_provider_configs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_memberships demo_principal_membership_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER demo_principal_membership_guard BEFORE INSERT OR UPDATE OF workspace_id, profile_id, active ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION private.demo_principal_membership_guard();


--
-- Name: profiles demo_principal_profile_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER demo_principal_profile_guard BEFORE INSERT OR UPDATE OF demo_principal, platform_role ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.demo_principal_profile_guard();


--
-- Name: guest_visits guest_visit_validate_insert_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guest_visit_validate_insert_update BEFORE INSERT OR UPDATE OF workspace_id, demo_generation, expires_at ON public.guest_visits FOR EACH ROW EXECUTE FUNCTION private.guest_visit_validate();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_staff_identity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_staff_identity_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.staff_identity_guard();


--
-- Name: workspace_assignment_proposals workspace_assignment_proposal_immutable_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_assignment_proposal_immutable_trigger BEFORE UPDATE ON public.workspace_assignment_proposals FOR EACH ROW EXECUTE FUNCTION private.workspace_assignment_proposal_immutable();


--
-- Name: workspace_memberships workspace_memberships_staff_identity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_memberships_staff_identity_guard BEFORE INSERT OR UPDATE ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION private.staff_identity_guard();


--
-- Name: owner_previews owner_previews_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: owner_previews owner_previews_effective_employee_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_effective_employee_profile_id_fkey FOREIGN KEY (effective_employee_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: owner_previews owner_previews_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: owner_previews owner_previews_session_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: owner_previews owner_previews_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.owner_previews
    ADD CONSTRAINT owner_previews_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: staff_accounts staff_accounts_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_accounts
    ADD CONSTRAINT staff_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: staff_accounts staff_accounts_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_accounts
    ADD CONSTRAINT staff_accounts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: staff_accounts staff_accounts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_accounts
    ADD CONSTRAINT staff_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: staff_import_rows staff_import_rows_import_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_import_rows
    ADD CONSTRAINT staff_import_rows_import_id_fkey FOREIGN KEY (import_id) REFERENCES private.staff_imports(id) ON DELETE CASCADE;


--
-- Name: staff_imports staff_imports_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_imports
    ADD CONSTRAINT staff_imports_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id);


--
-- Name: staff_imports staff_imports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_imports
    ADD CONSTRAINT staff_imports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: staff_password_claims staff_password_claims_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_claims
    ADD CONSTRAINT staff_password_claims_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: staff_password_claims staff_password_claims_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_claims
    ADD CONSTRAINT staff_password_claims_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES private.staff_accounts(profile_id) ON DELETE CASCADE;


--
-- Name: staff_password_resets staff_password_resets_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_resets
    ADD CONSTRAINT staff_password_resets_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: staff_password_resets staff_password_resets_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_resets
    ADD CONSTRAINT staff_password_resets_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id);


--
-- Name: staff_password_resets staff_password_resets_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_resets
    ADD CONSTRAINT staff_password_resets_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES private.staff_accounts(profile_id) ON DELETE CASCADE;


--
-- Name: staff_password_resets staff_password_resets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_password_resets
    ADD CONSTRAINT staff_password_resets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: staff_provisioning staff_provisioning_owner_profile_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_provisioning
    ADD CONSTRAINT staff_provisioning_owner_profile_id_fkey FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id);


--
-- Name: staff_provisioning staff_provisioning_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.staff_provisioning
    ADD CONSTRAINT staff_provisioning_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_order_activity_audit workspace_order_activity_audit_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.workspace_order_activity_audit
    ADD CONSTRAINT workspace_order_activity_audit_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_order_manual_audit workspace_order_manual_audit_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.workspace_order_manual_audit
    ADD CONSTRAINT workspace_order_manual_audit_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_order_schedule_audit workspace_order_schedule_audit_workspace_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.workspace_order_schedule_audit
    ADD CONSTRAINT workspace_order_schedule_audit_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: ai_settings ai_settings_default_provider_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_default_provider_config_id_fkey FOREIGN KEY (default_provider_config_id) REFERENCES public.ai_provider_configs(id) ON DELETE SET NULL;


--
-- Name: ai_settings ai_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_settings
    ADD CONSTRAINT ai_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: ai_task_routes ai_task_routes_provider_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_task_routes
    ADD CONSTRAINT ai_task_routes_provider_config_id_fkey FOREIGN KEY (provider_config_id) REFERENCES public.ai_provider_configs(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: guest_visits guest_visits_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_visits
    ADD CONSTRAINT guest_visits_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: knowledge_chunks knowledge_chunks_page_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_page_fkey FOREIGN KEY (workspace_id, document_id, version_id, page_no) REFERENCES public.knowledge_version_pages(workspace_id, document_id, version_id, page_no) ON DELETE RESTRICT;


--
-- Name: knowledge_chunks knowledge_chunks_workspace_id_document_id_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_workspace_id_document_id_version_id_fkey FOREIGN KEY (workspace_id, document_id, version_id) REFERENCES public.knowledge_versions(workspace_id, document_id, id) ON DELETE RESTRICT;


--
-- Name: knowledge_documents knowledge_document_published_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_document_published_version_fkey FOREIGN KEY (workspace_id, id, published_version_id) REFERENCES public.knowledge_versions(workspace_id, document_id, id) ON DELETE RESTRICT;


--
-- Name: knowledge_documents knowledge_documents_workspace_id_created_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_workspace_id_created_by_profile_id_fkey FOREIGN KEY (workspace_id, created_by_profile_id) REFERENCES public.workspace_memberships(workspace_id, profile_id) ON DELETE RESTRICT;


--
-- Name: knowledge_documents knowledge_documents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: knowledge_version_pages knowledge_version_pages_workspace_id_document_id_version_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_pages
    ADD CONSTRAINT knowledge_version_pages_workspace_id_document_id_version_i_fkey FOREIGN KEY (workspace_id, document_id, version_id) REFERENCES public.knowledge_versions(workspace_id, document_id, id) ON DELETE CASCADE;


--
-- Name: knowledge_versions knowledge_versions_workspace_id_created_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_versions
    ADD CONSTRAINT knowledge_versions_workspace_id_created_by_profile_id_fkey FOREIGN KEY (workspace_id, created_by_profile_id) REFERENCES public.workspace_memberships(workspace_id, profile_id) ON DELETE RESTRICT;


--
-- Name: knowledge_versions knowledge_versions_workspace_id_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_versions
    ADD CONSTRAINT knowledge_versions_workspace_id_document_id_fkey FOREIGN KEY (workspace_id, document_id) REFERENCES public.knowledge_documents(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: knowledge_versions knowledge_versions_workspace_id_reviewed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_versions
    ADD CONSTRAINT knowledge_versions_workspace_id_reviewed_by_profile_id_fkey FOREIGN KEY (workspace_id, reviewed_by_profile_id) REFERENCES public.workspace_memberships(workspace_id, profile_id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: workspace_assignment_proposal_audit workspace_assignment_proposal_aud_workspace_id_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_assignment_proposal_audit
    ADD CONSTRAINT workspace_assignment_proposal_aud_workspace_id_proposal_id_fkey FOREIGN KEY (workspace_id, proposal_id) REFERENCES public.workspace_assignment_proposals(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: workspace_assignment_proposals workspace_assignment_proposals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_assignment_proposals
    ADD CONSTRAINT workspace_assignment_proposals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_branches workspace_branches_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_branches
    ADD CONSTRAINT workspace_branches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_customers workspace_customers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_customers
    ADD CONSTRAINT workspace_customers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_memberships workspace_memberships_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: workspace_memberships workspace_memberships_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_orders workspace_orders_assigned_same_branch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_assigned_same_branch_fkey FOREIGN KEY (workspace_id, branch_id, assigned_technician_id) REFERENCES public.workspace_technicians(workspace_id, branch_id, id) ON DELETE RESTRICT;


--
-- Name: workspace_orders workspace_orders_workspace_id_assigned_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_workspace_id_assigned_technician_id_fkey FOREIGN KEY (workspace_id, assigned_technician_id) REFERENCES public.workspace_technicians(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: workspace_orders workspace_orders_workspace_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_workspace_id_branch_id_fkey FOREIGN KEY (workspace_id, branch_id) REFERENCES public.workspace_branches(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: workspace_orders workspace_orders_workspace_id_created_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_workspace_id_created_by_profile_id_fkey FOREIGN KEY (workspace_id, created_by_profile_id) REFERENCES public.workspace_memberships(workspace_id, profile_id) ON DELETE RESTRICT;


--
-- Name: workspace_orders workspace_orders_workspace_id_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_workspace_id_customer_id_fkey FOREIGN KEY (workspace_id, customer_id) REFERENCES public.workspace_customers(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: workspace_orders workspace_orders_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_orders
    ADD CONSTRAINT workspace_orders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_technicians workspace_technicians_workspace_id_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_technicians
    ADD CONSTRAINT workspace_technicians_workspace_id_branch_id_fkey FOREIGN KEY (workspace_id, branch_id) REFERENCES public.workspace_branches(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: workspace_technicians workspace_technicians_workspace_id_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_technicians
    ADD CONSTRAINT workspace_technicians_workspace_id_profile_id_fkey FOREIGN KEY (workspace_id, profile_id) REFERENCES public.workspace_memberships(workspace_id, profile_id) ON DELETE RESTRICT;


--
-- Name: guest_ai_budget_counter; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.guest_ai_budget_counter ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_ai_budget_policy; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.guest_ai_budget_policy ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_pdf_stage_attestations; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.knowledge_pdf_stage_attestations ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_previews; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.owner_previews ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_accounts; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.staff_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_import_rows; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.staff_import_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_imports; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.staff_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_password_claims; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.staff_password_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_password_resets; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.staff_password_resets ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_provisioning; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.staff_provisioning ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_provider_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_provider_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_task_routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_task_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guest_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks knowledge_chunks_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_chunks_owner_preview ON public.knowledge_chunks AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'chunks'::text, document_id, version_id));


--
-- Name: knowledge_chunks knowledge_chunks_read_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_chunks_read_scoped ON public.knowledge_chunks FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_versions v
  WHERE ((v.workspace_id = knowledge_chunks.workspace_id) AND (v.document_id = knowledge_chunks.document_id) AND (v.id = knowledge_chunks.version_id)))));


--
-- Name: knowledge_chunks knowledge_chunks_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_chunks_staff_readiness ON public.knowledge_chunks AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: knowledge_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_documents knowledge_documents_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_documents_owner_preview ON public.knowledge_documents AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'documents'::text, id));


--
-- Name: knowledge_documents knowledge_documents_read_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_documents_read_scoped ON public.knowledge_documents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.workspace_memberships m
     JOIN public.profiles p ON ((p.id = m.profile_id)))
     JOIN public.workspaces w ON ((w.id = m.workspace_id)))
  WHERE ((m.workspace_id = knowledge_documents.workspace_id) AND m.active AND p.active AND w.active AND (w.generation = knowledge_documents.generation) AND (p.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT ((auth.jwt() ->> 'is_anonymous'::text))::boolean AS bool) IS FALSE) OR (w.kind = 'DEMO'::public.workspace_kind)) AND ((knowledge_documents.created_by_profile_id = p.id) OR (knowledge_documents.state = 'PUBLISHED'::public.knowledge_document_state))))));


--
-- Name: knowledge_documents knowledge_documents_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_documents_staff_readiness ON public.knowledge_documents AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: knowledge_version_pages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_version_pages ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_version_pages knowledge_version_pages_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_version_pages_owner_preview ON public.knowledge_version_pages AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'pages'::text, document_id, version_id));


--
-- Name: knowledge_version_pages knowledge_version_pages_read_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_version_pages_read_scoped ON public.knowledge_version_pages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.knowledge_versions v
  WHERE ((v.workspace_id = knowledge_version_pages.workspace_id) AND (v.document_id = knowledge_version_pages.document_id) AND (v.id = knowledge_version_pages.version_id)))));


--
-- Name: knowledge_version_pages knowledge_version_pages_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_version_pages_staff_readiness ON public.knowledge_version_pages AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: knowledge_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_versions knowledge_versions_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_versions_owner_preview ON public.knowledge_versions AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'versions'::text, document_id, id));


--
-- Name: knowledge_versions knowledge_versions_read_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_versions_read_scoped ON public.knowledge_versions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.knowledge_documents d
     JOIN public.workspace_memberships m ON ((m.workspace_id = d.workspace_id)))
     JOIN public.profiles p ON ((p.id = m.profile_id)))
  WHERE ((d.workspace_id = knowledge_versions.workspace_id) AND (d.id = knowledge_versions.document_id) AND (d.generation = knowledge_versions.generation) AND m.active AND p.active AND (p.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((d.created_by_profile_id = p.id) OR ((d.state = 'PUBLISHED'::public.knowledge_document_state) AND (d.published_version_id = knowledge_versions.id) AND (knowledge_versions.index_state = 'READY'::public.knowledge_index_state)))))));


--
-- Name: knowledge_versions knowledge_versions_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_versions_staff_readiness ON public.knowledge_versions AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_read_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_read_self ON public.profiles FOR SELECT TO authenticated USING (((auth_user_id = ( SELECT auth.uid() AS uid)) AND active));


--
-- Name: workspace_assignment_proposal_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_assignment_proposal_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_assignment_proposals workspace_assignment_proposal_read_participant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_assignment_proposal_read_participant ON public.workspace_assignment_proposals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.profiles p
     JOIN public.workspace_memberships m ON ((m.profile_id = p.id)))
     JOIN public.workspaces w ON ((w.id = m.workspace_id)))
  WHERE ((p.auth_user_id = ( SELECT auth.uid() AS uid)) AND p.active AND (m.workspace_id = workspace_assignment_proposals.workspace_id) AND m.active AND (m.role = 'ADMIN'::public.app_role) AND w.active AND ((p.id = workspace_assignment_proposals.initiated_by_profile_id) OR (p.id = workspace_assignment_proposals.approver_profile_id)) AND ((( SELECT ((auth.jwt() ->> 'is_anonymous'::text))::boolean AS bool) IS FALSE) OR (w.kind = 'DEMO'::public.workspace_kind))))));


--
-- Name: workspace_assignment_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_assignment_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_assignment_proposals workspace_assignment_proposals_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_assignment_proposals_owner_preview ON public.workspace_assignment_proposals AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'proposals'::text, id));


--
-- Name: workspace_assignment_proposals workspace_assignment_proposals_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_assignment_proposals_staff_readiness ON public.workspace_assignment_proposals AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: workspace_branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_branches workspace_branches_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_branches_owner_preview ON public.workspace_branches AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'branches'::text, id));


--
-- Name: workspace_branches workspace_branches_read_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_branches_read_member ON public.workspace_branches FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.workspace_memberships m
     JOIN public.profiles p ON ((p.id = m.profile_id)))
     JOIN public.workspaces w ON ((w.id = m.workspace_id)))
  WHERE ((m.workspace_id = workspace_branches.workspace_id) AND m.active AND p.active AND w.active AND (p.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT ((auth.jwt() ->> 'is_anonymous'::text))::boolean AS bool) IS FALSE) OR (w.kind = 'DEMO'::public.workspace_kind))))));


--
-- Name: workspace_branches workspace_branches_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_branches_staff_readiness ON public.workspace_branches AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: workspace_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_customers workspace_customers_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_customers_owner_preview ON public.workspace_customers AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'customers'::text, id));


--
-- Name: workspace_customers workspace_customers_read_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_customers_read_member ON public.workspace_customers FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.workspace_memberships m
     JOIN public.profiles p ON ((p.id = m.profile_id)))
     JOIN public.workspaces w ON ((w.id = m.workspace_id)))
  WHERE ((m.workspace_id = workspace_customers.workspace_id) AND m.active AND p.active AND w.active AND (p.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT ((auth.jwt() ->> 'is_anonymous'::text))::boolean AS bool) IS FALSE) OR (w.kind = 'DEMO'::public.workspace_kind)) AND ((m.role = ANY (ARRAY['ADMIN'::public.app_role, 'MANAGER'::public.app_role])) OR (EXISTS ( SELECT 1
           FROM (public.workspace_orders o
             JOIN public.workspace_technicians t ON (((t.workspace_id = o.workspace_id) AND (t.id = o.assigned_technician_id))))
          WHERE ((o.workspace_id = workspace_customers.workspace_id) AND (o.customer_id = workspace_customers.id) AND (t.profile_id = m.profile_id) AND t.active))))))));


--
-- Name: workspace_customers workspace_customers_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_customers_staff_readiness ON public.workspace_customers AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: workspace_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_memberships workspace_memberships_read_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_memberships_read_self ON public.workspace_memberships FOR SELECT TO authenticated USING ((private.workspace_member_can_read(workspace_id) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = workspace_memberships.profile_id) AND p.active AND (p.auth_user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: workspace_memberships workspace_memberships_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_memberships_staff_readiness ON public.workspace_memberships AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: workspace_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_orders workspace_orders_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_orders_owner_preview ON public.workspace_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'orders'::text, id));


--
-- Name: workspace_orders workspace_orders_read_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_orders_read_member ON public.workspace_orders FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.workspace_memberships m
     JOIN public.profiles p ON ((p.id = m.profile_id)))
     JOIN public.workspaces w ON ((w.id = m.workspace_id)))
  WHERE ((m.workspace_id = workspace_orders.workspace_id) AND m.active AND p.active AND w.active AND (p.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT ((auth.jwt() ->> 'is_anonymous'::text))::boolean AS bool) IS FALSE) OR (w.kind = 'DEMO'::public.workspace_kind)) AND ((m.role = ANY (ARRAY['ADMIN'::public.app_role, 'MANAGER'::public.app_role])) OR (EXISTS ( SELECT 1
           FROM public.workspace_technicians t
          WHERE ((t.workspace_id = workspace_orders.workspace_id) AND (t.id = workspace_orders.assigned_technician_id) AND (t.profile_id = m.profile_id) AND t.active))))))));


--
-- Name: workspace_orders workspace_orders_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_orders_staff_readiness ON public.workspace_orders AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: workspace_technicians; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_technicians ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_technicians workspace_technicians_owner_preview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_technicians_owner_preview ON public.workspace_technicians AS RESTRICTIVE FOR SELECT TO authenticated USING (private.owner_preview_read_allowed(workspace_id, 'technicians'::text, id));


--
-- Name: workspace_technicians workspace_technicians_read_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_technicians_read_member ON public.workspace_technicians FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.workspace_memberships m
     JOIN public.profiles p ON ((p.id = m.profile_id)))
     JOIN public.workspaces w ON ((w.id = m.workspace_id)))
  WHERE ((m.workspace_id = workspace_technicians.workspace_id) AND m.active AND p.active AND w.active AND (p.auth_user_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT ((auth.jwt() ->> 'is_anonymous'::text))::boolean AS bool) IS FALSE) OR (w.kind = 'DEMO'::public.workspace_kind))))));


--
-- Name: workspace_technicians workspace_technicians_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_technicians_staff_readiness ON public.workspace_technicians AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(workspace_id));


--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspaces_read_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_read_member ON public.workspaces FOR SELECT TO authenticated USING (private.workspace_member_can_read(id));


--
-- Name: workspaces workspaces_staff_readiness; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_staff_readiness ON public.workspaces AS RESTRICTIVE FOR SELECT TO authenticated USING (private.staff_current_actor_ready(id));


--
-- Remove any Data API grants inherited from a new project's defaults
-- before replaying the reviewed explicit grants below.
REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM PUBLIC, anon, authenticated;

-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION demo_ensure_technician(p_workspace_id uuid, p_profile_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_ensure_technician(p_workspace_id uuid, p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.demo_ensure_technician(p_workspace_id uuid, p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION demo_principal_membership_guard(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_principal_membership_guard() FROM PUBLIC;


--
-- Name: FUNCTION demo_principal_profile_guard(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_principal_profile_guard() FROM PUBLIC;


--
-- Name: FUNCTION demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION private.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint) TO service_role;


--
-- Name: FUNCTION demo_reset_inventory(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_reset_inventory() FROM PUBLIC;
GRANT ALL ON FUNCTION private.demo_reset_inventory() TO service_role;


--
-- Name: FUNCTION demo_seed(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_seed() FROM PUBLIC;
GRANT ALL ON FUNCTION private.demo_seed() TO service_role;


--
-- Name: FUNCTION demo_seed_knowledge(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.demo_seed_knowledge() FROM PUBLIC;
GRANT ALL ON FUNCTION private.demo_seed_knowledge() TO service_role;


--
-- Name: FUNCTION guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION private.guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) TO service_role;


--
-- Name: FUNCTION guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer) TO service_role;


--
-- Name: FUNCTION guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION private.guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) TO service_role;


--
-- Name: FUNCTION guest_ai_budget_status_admin(p_actor_auth_user_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.guest_ai_budget_status_admin(p_actor_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.guest_ai_budget_status_admin(p_actor_auth_user_id uuid) TO service_role;


--
-- Name: FUNCTION guest_visit_validate(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.guest_visit_validate() FROM PUBLIC;


--
-- Name: FUNCTION knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) TO authenticated;


--
-- Name: FUNCTION knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) TO authenticated;


--
-- Name: FUNCTION knowledge_editor(p_workspace_id uuid, p_generation bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_editor(p_workspace_id uuid, p_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_editor(p_workspace_id uuid, p_generation bigint) TO authenticated;


--
-- Name: FUNCTION knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) TO authenticated;


--
-- Name: FUNCTION knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) TO authenticated;


--
-- Name: FUNCTION knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid) TO service_role;


--
-- Name: FUNCTION knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_stage_pages(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_kind text, p_pages text[]); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_stage_pages(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_kind text, p_pages text[]) FROM PUBLIC;


--
-- Name: FUNCTION knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION private.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) TO authenticated;


--
-- Name: FUNCTION mcp_session_active(p_auth_user_id uuid, p_session_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.mcp_session_active(p_auth_user_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.mcp_session_active(p_auth_user_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION owner_preview_assert_owner(p_workspace_id uuid, p_lock boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_preview_assert_owner(p_workspace_id uuid, p_lock boolean) FROM PUBLIC;


--
-- Name: FUNCTION owner_preview_audit(p_preview_id uuid, p_event text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_preview_audit(p_preview_id uuid, p_event text) FROM PUBLIC;


--
-- Name: FUNCTION owner_preview_employee_valid(p_workspace_id uuid, p_profile_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_preview_employee_valid(p_workspace_id uuid, p_profile_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION owner_preview_json(p_preview_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_preview_json(p_preview_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION owner_preview_read_allowed(p_workspace_id uuid, p_kind text, p_row_id uuid, p_version_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_preview_read_allowed(p_workspace_id uuid, p_kind text, p_row_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.owner_preview_read_allowed(p_workspace_id uuid, p_kind text, p_row_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION owner_preview_valid(p_preview_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_preview_valid(p_preview_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION staff_account_summary(p_profile_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_account_summary(p_profile_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION staff_actor_ready(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid, p_lock boolean, p_allow_password_pending boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_actor_ready(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid, p_lock boolean, p_allow_password_pending boolean) FROM PUBLIC;


--
-- Name: FUNCTION staff_assert_owner(p_auth_user_id uuid, p_session_id uuid, p_workspace_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_assert_owner(p_auth_user_id uuid, p_session_id uuid, p_workspace_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION staff_auth_password_fingerprint(p_auth_user_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_auth_password_fingerprint(p_auth_user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION staff_current_actor_ready(p_workspace_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_current_actor_ready(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.staff_current_actor_ready(p_workspace_id uuid) TO authenticated;
GRANT ALL ON FUNCTION private.staff_current_actor_ready(p_workspace_id uuid) TO service_role;


--
-- Name: FUNCTION staff_identity_guard(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_identity_guard() FROM PUBLIC;


--
-- Name: FUNCTION staff_import_input_valid(p_input jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_import_input_valid(p_input jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.staff_import_input_valid(p_input jsonb) TO service_role;


--
-- Name: FUNCTION staff_initialize_password_fingerprint(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_initialize_password_fingerprint() FROM PUBLIC;


--
-- Name: FUNCTION staff_input_valid(p_input jsonb, p_email text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_input_valid(p_input jsonb, p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.staff_input_valid(p_input jsonb, p_email text) TO service_role;


--
-- Name: FUNCTION staff_password_current(p_profile_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_password_current(p_profile_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION staff_password_reset_reconcile(p_request_key uuid, p_owner_profile_id uuid, p_workspace_id uuid, p_profile_id uuid, p_claim_token uuid, p_require_live_claim boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_password_reset_reconcile(p_request_key uuid, p_owner_profile_id uuid, p_workspace_id uuid, p_profile_id uuid, p_claim_token uuid, p_require_live_claim boolean) FROM PUBLIC;


--
-- Name: FUNCTION staff_require_actor(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_require_actor(p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION staff_signed_session_id(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.staff_signed_session_id() FROM PUBLIC;


--
-- Name: TABLE workspace_assignment_proposals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_assignment_proposals TO service_role;
GRANT SELECT ON TABLE public.workspace_assignment_proposals TO authenticated;


--
-- Name: FUNCTION workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid) TO service_role;


--
-- Name: FUNCTION workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) TO authenticated;


--
-- Name: FUNCTION workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) TO service_role;


--
-- Name: FUNCTION workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) TO authenticated;


--
-- Name: FUNCTION workspace_assignment_proposal_immutable(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_assignment_proposal_immutable() FROM PUBLIC;


--
-- Name: FUNCTION workspace_assignment_proposal_insert(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_profile_id uuid, p_source_client text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_assignment_proposal_insert(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_profile_id uuid, p_source_client text) FROM PUBLIC;


--
-- Name: FUNCTION workspace_member_can_read(p_workspace_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_member_can_read(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_member_can_read(p_workspace_id uuid) TO authenticated;


--
-- Name: FUNCTION workspace_order_admin_profile(p_workspace_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_admin_profile(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_admin_profile(p_workspace_id uuid) TO authenticated;


--
-- Name: TABLE workspace_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_orders TO service_role;
GRANT SELECT ON TABLE public.workspace_orders TO authenticated;


--
-- Name: FUNCTION workspace_order_assign(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_assign(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION workspace_order_assign_current(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_assign_current(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) FROM PUBLIC;


--
-- Name: FUNCTION workspace_order_create(p_workspace_id uuid, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_create(p_workspace_id uuid, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) FROM PUBLIC;


--
-- Name: FUNCTION workspace_order_create_current(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_create_current(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) FROM PUBLIC;


--
-- Name: FUNCTION workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text) FROM PUBLIC;


--
-- Name: FUNCTION workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_manual_actor(p_workspace_id uuid, p_expected_generation bigint, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_manual_actor(p_workspace_id uuid, p_expected_generation bigint, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;


--
-- Name: FUNCTION workspace_order_manual_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_manual_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_manual_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_manual_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_manual_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_manual_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_manual_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_manual_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_manual_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_require_generation(p_workspace_id uuid, p_expected_generation bigint); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_require_generation(p_workspace_id uuid, p_expected_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_require_generation(p_workspace_id uuid, p_expected_generation bigint) TO authenticated;


--
-- Name: FUNCTION workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION admin_delete_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid) TO service_role;


--
-- Name: FUNCTION admin_update_ai_routing(p_actor_profile_id uuid, p_routing_mode public.ai_routing_mode, p_default_provider_config_id uuid, p_routes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_ai_routing(p_actor_profile_id uuid, p_routing_mode public.ai_routing_mode, p_default_provider_config_id uuid, p_routes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_ai_routing(p_actor_profile_id uuid, p_routing_mode public.ai_routing_mode, p_default_provider_config_id uuid, p_routes jsonb) TO service_role;


--
-- Name: FUNCTION admin_upsert_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid, p_create_request_key uuid, p_create_payload_signature text, p_name text, p_provider_type text, p_base_url text, p_model text, p_capabilities jsonb, p_encrypted_api_key text, p_api_key_iv text, p_api_key_auth_tag text, p_encryption_version smallint, p_key_last4 text, p_status public.ai_provider_status); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_upsert_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid, p_create_request_key uuid, p_create_payload_signature text, p_name text, p_provider_type text, p_base_url text, p_model text, p_capabilities jsonb, p_encrypted_api_key text, p_api_key_iv text, p_api_key_auth_tag text, p_encryption_version smallint, p_key_last4 text, p_status public.ai_provider_status) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_upsert_ai_provider(p_actor_profile_id uuid, p_provider_config_id uuid, p_create_request_key uuid, p_create_payload_signature text, p_name text, p_provider_type text, p_base_url text, p_model text, p_capabilities jsonb, p_encrypted_api_key text, p_api_key_iv text, p_api_key_auth_tag text, p_encryption_version smallint, p_key_last4 text, p_status public.ai_provider_status) TO service_role;


--
-- Name: FUNCTION ai_assert_config_actor(p_actor_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ai_assert_config_actor(p_actor_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ai_assert_config_actor(p_actor_profile_id uuid) TO service_role;


--
-- Name: FUNCTION ai_profile_supports_task(p_capabilities jsonb, p_task_type public.ai_task_type, p_input_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ai_profile_supports_task(p_capabilities jsonb, p_task_type public.ai_task_type, p_input_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ai_profile_supports_task(p_capabilities jsonb, p_task_type public.ai_task_type, p_input_kind text) TO service_role;


--
-- Name: FUNCTION demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.demo_reset(p_actor_auth_user_id uuid, p_expected_generation bigint) TO service_role;


--
-- Name: FUNCTION demo_reset_inventory(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.demo_reset_inventory() FROM PUBLIC;
GRANT ALL ON FUNCTION public.demo_reset_inventory() TO service_role;


--
-- Name: FUNCTION demo_seed(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.demo_seed() FROM PUBLIC;
GRANT ALL ON FUNCTION public.demo_seed() TO service_role;


--
-- Name: FUNCTION guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guest_ai_budget_reserve(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) TO service_role;


--
-- Name: FUNCTION guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guest_ai_budget_set_limit(p_actor_auth_user_id uuid, p_daily_limit integer) TO service_role;


--
-- Name: FUNCTION guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guest_ai_budget_status(p_visit_id uuid, p_workspace_id uuid, p_generation bigint) TO service_role;


--
-- Name: FUNCTION guest_ai_budget_status_admin(p_actor_auth_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guest_ai_budget_status_admin(p_actor_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.guest_ai_budget_status_admin(p_actor_auth_user_id uuid) TO service_role;


--
-- Name: FUNCTION knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_archive(p_workspace_id uuid, p_generation bigint, p_document_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_claim_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_consume_pdf_attestation(p_token uuid, p_pages text[]) TO authenticated;


--
-- Name: FUNCTION knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_create_document(p_workspace_id uuid, p_generation bigint, p_title text, p_source_label text) TO authenticated;


--
-- Name: FUNCTION knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_fail_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_error_code text) TO authenticated;


--
-- Name: FUNCTION knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_finish_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid, p_token uuid, p_page_numbers integer[], p_contents text[]) TO authenticated;


--
-- Name: FUNCTION knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_issue_pdf_attestation(p_actor_auth_user_id uuid, p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_pages text[], p_actor_session_id uuid) TO service_role;


--
-- Name: FUNCTION knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_publish(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_retry_index(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_version_id uuid) TO authenticated;


--
-- Name: FUNCTION knowledge_search_keyword(p_workspace_id uuid, p_query text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_search_keyword(p_workspace_id uuid, p_query text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_search_keyword(p_workspace_id uuid, p_query text, p_limit integer) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_search_keyword(p_workspace_id uuid, p_query text, p_limit integer) TO authenticated;


--
-- Name: FUNCTION knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) TO service_role;
GRANT ALL ON FUNCTION public.knowledge_stage_text(p_workspace_id uuid, p_generation bigint, p_document_id uuid, p_source_text text, p_chunks text[]) TO authenticated;


--
-- Name: FUNCTION mcp_session_active(p_auth_user_id uuid, p_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mcp_session_active(p_auth_user_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mcp_session_active(p_auth_user_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION owner_preview_exit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.owner_preview_exit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.owner_preview_exit() TO service_role;
GRANT ALL ON FUNCTION public.owner_preview_exit() TO authenticated;


--
-- Name: FUNCTION owner_preview_options(p_workspace_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.owner_preview_options(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.owner_preview_options(p_workspace_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.owner_preview_options(p_workspace_id uuid) TO authenticated;


--
-- Name: FUNCTION owner_preview_set(p_workspace_id uuid, p_role public.app_role, p_employee_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.owner_preview_set(p_workspace_id uuid, p_role public.app_role, p_employee_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.owner_preview_set(p_workspace_id uuid, p_role public.app_role, p_employee_profile_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.owner_preview_set(p_workspace_id uuid, p_role public.app_role, p_employee_profile_id uuid) TO authenticated;


--
-- Name: FUNCTION owner_preview_status(p_workspace_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.owner_preview_status(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.owner_preview_status(p_workspace_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.owner_preview_status(p_workspace_id uuid) TO authenticated;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION staff_claim_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_retry_failed boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_claim_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_retry_failed boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_claim_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_retry_failed boolean) TO service_role;


--
-- Name: FUNCTION staff_complete_password_change(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid, p_claim_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_complete_password_change(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid, p_claim_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_complete_password_change(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid, p_claim_id uuid) TO service_role;


--
-- Name: FUNCTION staff_fail_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_fail_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_fail_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid) TO service_role;


--
-- Name: FUNCTION staff_finalize_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_finalize_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_finalize_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_claim_token uuid) TO service_role;


--
-- Name: FUNCTION staff_finalize_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_request_key uuid, p_claim_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_finalize_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_request_key uuid, p_claim_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_finalize_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_request_key uuid, p_claim_token uuid) TO service_role;


--
-- Name: FUNCTION staff_finish_import_batch(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_claim_token uuid, p_results jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_finish_import_batch(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_claim_token uuid, p_results jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_finish_import_batch(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_import_id uuid, p_claim_token uuid, p_results jsonb) TO service_role;


--
-- Name: FUNCTION staff_issue_password_claim(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_issue_password_claim(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_issue_password_claim(p_auth_user_id uuid, p_expected_revision uuid, p_actor_session_id uuid) TO service_role;


--
-- Name: FUNCTION staff_list(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_list(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_list(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid) TO service_role;


--
-- Name: FUNCTION staff_preview_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_rows jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_preview_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_rows jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_preview_import(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_rows jsonb) TO service_role;


--
-- Name: FUNCTION staff_reserve_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_input jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_reserve_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_input jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_reserve_creation(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_request_key uuid, p_input jsonb) TO service_role;


--
-- Name: FUNCTION staff_reserve_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_request_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_reserve_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_request_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_reserve_password_reset(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_request_key uuid) TO service_role;


--
-- Name: FUNCTION staff_session_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_session_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_session_status() TO service_role;
GRANT ALL ON FUNCTION public.staff_session_status() TO authenticated;


--
-- Name: FUNCTION staff_update_account(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_role public.app_role, p_branch_code text, p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_update_account(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_role public.app_role, p_branch_code text, p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_update_account(p_owner_auth_user_id uuid, p_owner_session_id uuid, p_workspace_id uuid, p_profile_id uuid, p_expected_revision uuid, p_role public.app_role, p_branch_code text, p_active boolean) TO service_role;


--
-- Name: FUNCTION workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_assignment_proposal_approve(p_workspace_id uuid, p_proposal_id uuid, p_approver_auth_user_id uuid, p_actor_session_id uuid) TO service_role;


--
-- Name: FUNCTION workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) TO service_role;
GRANT ALL ON FUNCTION public.workspace_assignment_proposal_create(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid) TO authenticated;


--
-- Name: FUNCTION workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_assignment_proposal_create_mcp(p_workspace_id uuid, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_idempotency_key uuid, p_initiator_auth_user_id uuid) TO service_role;


--
-- Name: FUNCTION workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.workspace_assignment_proposal_execute(p_workspace_id uuid, p_proposal_id uuid) TO authenticated;


--
-- Name: FUNCTION workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.workspace_order_assign(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_technician_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text) TO service_role;


--
-- Name: FUNCTION workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.workspace_order_create(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_id uuid, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text) TO service_role;


--
-- Name: FUNCTION workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.workspace_order_create_with_customer(p_workspace_id uuid, p_expected_generation bigint, p_order_no text, p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_address text, p_problem_description text, p_service_type text, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.workspace_order_manager_reschedule(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_scheduled_at timestamp with time zone, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: FUNCTION workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) TO service_role;
GRANT ALL ON FUNCTION public.workspace_order_technician_transition(p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid, p_expected_updated_at timestamp with time zone, p_next_status public.service_order_status, p_guest_visit_id uuid, p_guest_token_hash text) TO authenticated;


--
-- Name: TABLE staff_accounts; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.staff_accounts TO service_role;


--
-- Name: TABLE staff_import_rows; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.staff_import_rows TO service_role;


--
-- Name: TABLE staff_imports; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.staff_imports TO service_role;


--
-- Name: TABLE staff_provisioning; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.staff_provisioning TO service_role;


--
-- Name: TABLE ai_provider_configs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_provider_configs TO service_role;


--
-- Name: TABLE ai_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_settings TO service_role;


--
-- Name: TABLE ai_task_routes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_task_routes TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE guest_visits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.guest_visits TO service_role;


--
-- Name: TABLE knowledge_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.knowledge_chunks TO service_role;
GRANT SELECT ON TABLE public.knowledge_chunks TO authenticated;


--
-- Name: TABLE knowledge_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.knowledge_documents TO service_role;
GRANT SELECT ON TABLE public.knowledge_documents TO authenticated;


--
-- Name: TABLE knowledge_version_pages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.knowledge_version_pages TO service_role;
GRANT SELECT ON TABLE public.knowledge_version_pages TO authenticated;


--
-- Name: TABLE knowledge_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.knowledge_versions TO service_role;
GRANT SELECT ON TABLE public.knowledge_versions TO authenticated;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE workspace_assignment_proposal_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_assignment_proposal_audit TO service_role;


--
-- Name: TABLE workspace_branches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_branches TO service_role;
GRANT SELECT ON TABLE public.workspace_branches TO authenticated;


--
-- Name: TABLE workspace_customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_customers TO service_role;
GRANT SELECT ON TABLE public.workspace_customers TO authenticated;


--
-- Name: TABLE workspace_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_memberships TO service_role;
GRANT SELECT ON TABLE public.workspace_memberships TO authenticated;


--
-- Name: TABLE workspace_technicians; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_technicians TO service_role;
GRANT SELECT ON TABLE public.workspace_technicians TO authenticated;


--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspaces TO service_role;
GRANT SELECT ON TABLE public.workspaces TO authenticated;


-- Future postgres-owned application objects stay server-side by default.
-- New migrations must still explicitly review their grants and RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

-- PostgreSQL database dump complete
--
