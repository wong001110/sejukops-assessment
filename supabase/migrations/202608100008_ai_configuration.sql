-- Phase 6: provider-agnostic AI configuration and encrypted BYOK routing.
-- Plaintext provider credentials never cross this database boundary.

alter table public.ai_provider_configs
  add column api_key_iv text,
  add column api_key_auth_tag text,
  add column encryption_version smallint,
  add column create_request_key uuid unique,
  add column create_payload_signature text;

alter table public.ai_provider_configs
  add constraint ai_provider_type_supported check (
    provider_type = 'OPENAI_COMPATIBLE'
  ),
  add constraint ai_provider_base_url_present check (
    base_url is not null and btrim(base_url) <> ''
  ),
  add constraint ai_provider_capabilities_complete check (
    pg_catalog.jsonb_typeof(capabilities) = 'object'
    and pg_catalog.jsonb_typeof(capabilities -> 'text') = 'boolean'
    and pg_catalog.jsonb_typeof(capabilities -> 'vision') = 'boolean'
    and pg_catalog.jsonb_typeof(capabilities -> 'toolCalling') = 'boolean'
    and pg_catalog.jsonb_typeof(capabilities -> 'structuredOutput') = 'boolean'
    and capabilities - array[
      'text', 'vision', 'toolCalling', 'structuredOutput'
    ] = '{}'::jsonb
  ),
  add constraint ai_provider_encrypted_credential_complete check (
    (
      encrypted_api_key is null
      and api_key_iv is null
      and api_key_auth_tag is null
      and encryption_version is null
      and key_last4 is null
    )
    or (
      encrypted_api_key is not null
      and api_key_iv is not null
      and api_key_auth_tag is not null
      and encryption_version = 1
      and key_last4 is not null
    )
  ),
  add constraint ai_provider_create_idempotency_complete check (
    (create_request_key is null and create_payload_signature is null)
    or (
      create_request_key is not null
      and create_payload_signature ~ '^[0-9a-f]{64}$'
    )
  );

-- The assessment is single-organisation, so settings have one stable row.
alter table public.ai_settings
  add constraint ai_settings_singleton check (
    id = '00000000-0000-4000-8000-00000000a100'::uuid
  );

drop policy if exists ai_provider_configs_admin_only on public.ai_provider_configs;
drop policy if exists ai_settings_admin_only on public.ai_settings;
drop policy if exists ai_task_routes_admin_only on public.ai_task_routes;

revoke all on table public.ai_provider_configs from public, anon, authenticated;
revoke all on table public.ai_settings from public, anon, authenticated;
revoke all on table public.ai_task_routes from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_provider_configs to service_role;
grant select, insert, update, delete on table public.ai_settings to service_role;
grant select, insert, update, delete on table public.ai_task_routes to service_role;

create or replace function public.ai_assert_config_actor(p_actor_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then
    raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001';
  end if;
  return true;
end;
$$;

create or replace function public.ai_assert_runtime_actor(p_actor_profile_id uuid)
returns public.app_role
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = p_actor_profile_id
    and p.role in ('ADMIN', 'MANAGER')
    and p.active;
  if v_role is null then
    raise exception 'INVALID_AI_RUNTIME_ACTOR' using errcode = 'P0001';
  end if;
  return v_role;
end;
$$;

create or replace function public.ai_profile_supports_task(
  p_capabilities jsonb,
  p_task_type public.ai_task_type,
  p_input_kind text default 'TEXT'
)
returns boolean
language sql
immutable
set search_path = ''
as $$
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

create or replace function public.admin_upsert_ai_provider(
  p_actor_profile_id uuid,
  p_provider_config_id uuid,
  p_create_request_key uuid,
  p_create_payload_signature text,
  p_name text,
  p_provider_type text,
  p_base_url text,
  p_model text,
  p_capabilities jsonb,
  p_encrypted_api_key text,
  p_api_key_iv text,
  p_api_key_auth_tag text,
  p_encryption_version smallint,
  p_key_last4 text,
  p_status public.ai_provider_status
)
returns table (provider_config_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.admin_delete_ai_provider(
  p_actor_profile_id uuid,
  p_provider_config_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
    if pg_catalog.jsonb_object_length(p_routes) <> 4
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

  delete from public.ai_task_routes;
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

revoke all on function public.ai_assert_config_actor(uuid)
from public, anon, authenticated;
revoke all on function public.ai_assert_runtime_actor(uuid)
from public, anon, authenticated;
revoke all on function public.ai_profile_supports_task(
  jsonb, public.ai_task_type, text
) from public, anon, authenticated;
revoke all on function public.admin_upsert_ai_provider(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, text,
  smallint, text, public.ai_provider_status
) from public, anon, authenticated;
revoke all on function public.admin_delete_ai_provider(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.admin_update_ai_routing(
  uuid, public.ai_routing_mode, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.ai_assert_config_actor(uuid) to service_role;
grant execute on function public.ai_assert_runtime_actor(uuid) to service_role;
grant execute on function public.admin_upsert_ai_provider(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, text,
  smallint, text, public.ai_provider_status
) to service_role;
grant execute on function public.admin_delete_ai_provider(uuid, uuid) to service_role;
grant execute on function public.admin_update_ai_routing(
  uuid, public.ai_routing_mode, uuid, jsonb
) to service_role;

comment on function public.admin_delete_ai_provider(uuid, uuid) is
  'Atomically clears default/task routes before removing encrypted AI provider configuration.';
comment on function public.admin_update_ai_routing(
  uuid, public.ai_routing_mode, uuid, jsonb
) is 'Atomically replaces organisation-level AI routing after capability validation.';
