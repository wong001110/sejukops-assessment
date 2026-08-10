-- Phase 6 corrective migration: Supabase safe-update enforcement rejects a
-- DELETE without a WHERE clause. task_type is NOT NULL by schema, so this
-- explicit predicate safely clears the full single-organisation route set.

create or replace function public.admin_update_ai_routing(
  p_actor_profile_id uuid,
  p_routing_mode public.ai_routing_mode,
  p_default_provider_config_id uuid,
  p_routes jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.admin_update_ai_routing(
  uuid, public.ai_routing_mode, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_update_ai_routing(
  uuid, public.ai_routing_mode, uuid, jsonb
) to service_role;

comment on function public.admin_update_ai_routing(
  uuid, public.ai_routing_mode, uuid, jsonb
) is 'Atomically replaces AI routing with portable key counting and a safe full-delete predicate.';
