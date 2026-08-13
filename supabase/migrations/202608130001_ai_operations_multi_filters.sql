-- Expand the existing approved AI Operations tools with bounded multi-value filters.
-- The LLM still selects at most one approved tool per request; this migration only
-- increases parameter expressiveness inside that controlled tool boundary.

revoke execute on function public.manager_ai_get_jobs(
  uuid, text, text, text, text, text, boolean, integer, timestamptz
) from service_role;
revoke execute on function public.manager_ai_get_technician_stats(
  uuid, text, text, integer, timestamptz
) from service_role;
revoke execute on function public.manager_ai_get_workload(
  uuid, text, text, integer, timestamptz
) from service_role;

drop function public.manager_ai_get_jobs(
  uuid, text, text, text, text, text, boolean, integer, timestamptz
);
drop function public.manager_ai_get_technician_stats(
  uuid, text, text, integer, timestamptz
);
drop function public.manager_ai_get_workload(
  uuid, text, text, integer, timestamptz
);

create or replace function public.manager_ai_get_jobs(
  p_actor_profile_id uuid,
  p_period text default null,
  p_technician_names text[] default null,
  p_statuses text[] default null,
  p_service_types text[] default null,
  p_order_numbers text[] default null,
  p_completed_only boolean default false,
  p_limit integer default 20,
  p_as_of timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 25);
  v_items jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;

  if p_period is null and p_order_numbers is null then
    raise exception 'AI_OPERATIONS_FILTER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_technician_names is not null and (
    cardinality(p_technician_names) not between 1 and 10
    or array_position(p_technician_names, null) is not null
    or exists (
      select 1 from unnest(p_technician_names) value
      where btrim(value) = '' or char_length(btrim(value)) > 120
    )
  ) then
    raise exception 'INVALID_AI_OPERATIONS_TECHNICIANS' using errcode = 'P0001';
  end if;

  if p_statuses is not null and (
    cardinality(p_statuses) not between 1 and 10
    or array_position(p_statuses, null) is not null
    or exists (
      select 1 from unnest(p_statuses) value
      where value not in ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'JOB_DONE', 'REVIEWED', 'CLOSED')
    )
  ) then
    raise exception 'INVALID_AI_OPERATIONS_STATUS' using errcode = 'P0001';
  end if;

  if p_service_types is not null and (
    cardinality(p_service_types) not between 1 and 10
    or array_position(p_service_types, null) is not null
    or exists (
      select 1 from unnest(p_service_types) value
      where btrim(value) = '' or char_length(btrim(value)) > 120
    )
  ) then
    raise exception 'INVALID_AI_OPERATIONS_SERVICE_TYPES' using errcode = 'P0001';
  end if;

  if p_order_numbers is not null and (
    cardinality(p_order_numbers) not between 1 and 10
    or array_position(p_order_numbers, null) is not null
    or exists (
      select 1 from unnest(p_order_numbers) value
      where btrim(value) !~* '^ORD-[0-9]{4}-[0-9]{4,}$'
    )
  ) then
    raise exception 'INVALID_AI_OPERATIONS_ORDER_NUMBERS' using errcode = 'P0001';
  end if;

  if p_period is not null then
    select b.start_at, b.end_at into v_start, v_end
    from public.manager_ai_period_bounds(p_period, p_as_of) b;
  end if;

  select coalesce(
    jsonb_agg(pg_catalog.to_jsonb(q) order by q.sort_at desc nulls last, q.order_number),
    '[]'::jsonb
  ) into v_items
  from (
    select
      o.order_no as order_number,
      o.status::text as status,
      o.service_type,
      p.display_name as technician_name,
      o.scheduled_at,
      sr.completed_at,
      case when o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
        then coalesce(sr.final_amount, o.quoted_price)
        else o.quoted_price
      end::numeric as final_amount,
      case when o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
        then sr.completed_at
        else coalesce(o.scheduled_at, o.created_at)
      end as sort_at
    from public.orders o
    left join public.technicians t on t.id = o.assigned_technician_id
    left join public.profiles p on p.id = t.profile_id
    left join public.service_reports sr on sr.order_id = o.id
    where (
        p_order_numbers is null
        or exists (
          select 1 from unnest(p_order_numbers) value
          where pg_catalog.upper(o.order_no) = pg_catalog.upper(btrim(value))
        )
      )
      and (
        p_technician_names is null
        or exists (
          select 1 from unnest(p_technician_names) value
          where pg_catalog.lower(p.display_name) = pg_catalog.lower(btrim(value))
        )
      )
      and (p_statuses is null or o.status::text = any(p_statuses))
      and (
        p_service_types is null
        or exists (
          select 1 from unnest(p_service_types) value
          where pg_catalog.lower(o.service_type) = pg_catalog.lower(btrim(value))
        )
      )
      and (
        not p_completed_only
        or (
          o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
          and sr.completed_at is not null
        )
      )
      and (
        p_period is null
        or (
          case
            when p_completed_only then sr.completed_at
            when o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED') then sr.completed_at
            else coalesce(o.scheduled_at, o.created_at)
          end
        ) >= v_start
        and (
          case
            when p_completed_only then sr.completed_at
            when o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED') then sr.completed_at
            else coalesce(o.scheduled_at, o.created_at)
          end
        ) < v_end
      )
    order by sort_at desc nulls last, o.order_no
    limit v_limit
  ) q;

  return jsonb_build_object(
    'range', case when p_period is null then null else jsonb_build_object(
      'start', v_start,
      'end', v_end
    ) end,
    'items', v_items
  );
end;
$$;

create or replace function public.manager_ai_get_technician_stats(
  p_actor_profile_id uuid,
  p_period text,
  p_technician_names text[] default null,
  p_limit integer default 20,
  p_as_of timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 25);
  v_items jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;

  if p_technician_names is not null and (
    cardinality(p_technician_names) not between 1 and 10
    or array_position(p_technician_names, null) is not null
    or exists (
      select 1 from unnest(p_technician_names) value
      where btrim(value) = '' or char_length(btrim(value)) > 120
    )
  ) then
    raise exception 'INVALID_AI_OPERATIONS_TECHNICIANS' using errcode = 'P0001';
  end if;

  select b.start_at, b.end_at into v_start, v_end
  from public.manager_ai_period_bounds(p_period, p_as_of) b;

  select coalesce(
    jsonb_agg(pg_catalog.to_jsonb(q) order by q.completed_jobs desc, q.completed_amount desc, q.technician_name),
    '[]'::jsonb
  ) into v_items
  from (
    select
      t.id as technician_id,
      p.display_name as technician_name,
      pg_catalog.count(o.id)::integer as completed_jobs,
      coalesce(pg_catalog.sum(sr.final_amount) filter (where o.id is not null), 0)::numeric as completed_amount
    from public.technicians t
    join public.profiles p on p.id = t.profile_id and p.active
    left join public.service_reports sr
      on sr.technician_id = t.id
      and sr.completed_at >= v_start and sr.completed_at < v_end
    left join public.orders o
      on o.id = sr.order_id
      and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
    where t.active
      and (
        p_technician_names is null
        or exists (
          select 1 from unnest(p_technician_names) value
          where pg_catalog.lower(p.display_name) = pg_catalog.lower(btrim(value))
        )
      )
    group by t.id, p.display_name
    order by completed_jobs desc, completed_amount desc, p.display_name
    limit v_limit
  ) q;

  return jsonb_build_object(
    'range', jsonb_build_object('start', v_start, 'end', v_end),
    'items', v_items
  );
end;
$$;

create or replace function public.manager_ai_get_workload(
  p_actor_profile_id uuid,
  p_period text,
  p_technician_names text[] default null,
  p_limit integer default 20,
  p_as_of timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 25);
  v_items jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;

  if p_technician_names is not null and (
    cardinality(p_technician_names) not between 1 and 10
    or array_position(p_technician_names, null) is not null
    or exists (
      select 1 from unnest(p_technician_names) value
      where btrim(value) = '' or char_length(btrim(value)) > 120
    )
  ) then
    raise exception 'INVALID_AI_OPERATIONS_TECHNICIANS' using errcode = 'P0001';
  end if;

  select b.start_at, b.end_at into v_start, v_end
  from public.manager_ai_period_bounds(p_period, p_as_of) b;

  select coalesce(
    jsonb_agg(pg_catalog.to_jsonb(q) order by q.active_jobs desc, q.technician_name),
    '[]'::jsonb
  ) into v_items
  from (
    select
      t.id as technician_id,
      p.display_name as technician_name,
      pg_catalog.count(o.id) filter (where o.status in ('ASSIGNED', 'IN_PROGRESS'))::integer as active_jobs,
      pg_catalog.count(o.id) filter (where o.status = 'ASSIGNED')::integer as assigned_jobs,
      pg_catalog.count(o.id) filter (where o.status = 'IN_PROGRESS')::integer as in_progress_jobs
    from public.technicians t
    join public.profiles p on p.id = t.profile_id and p.active
    left join public.orders o
      on o.assigned_technician_id = t.id
      and o.status in ('ASSIGNED', 'IN_PROGRESS')
      and o.scheduled_at >= v_start and o.scheduled_at < v_end
    where t.active
      and (
        p_technician_names is null
        or exists (
          select 1 from unnest(p_technician_names) value
          where pg_catalog.lower(p.display_name) = pg_catalog.lower(btrim(value))
        )
      )
    group by t.id, p.display_name
    order by active_jobs desc, p.display_name
    limit v_limit
  ) q;

  return jsonb_build_object(
    'range', jsonb_build_object('start', v_start, 'end', v_end),
    'items', v_items
  );
end;
$$;

revoke all on function public.manager_ai_get_jobs(
  uuid, text, text[], text[], text[], text[], boolean, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.manager_ai_get_technician_stats(
  uuid, text, text[], integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.manager_ai_get_workload(
  uuid, text, text[], integer, timestamptz
) from public, anon, authenticated;

grant execute on function public.manager_ai_get_jobs(
  uuid, text, text[], text[], text[], text[], boolean, integer, timestamptz
) to service_role;
grant execute on function public.manager_ai_get_technician_stats(
  uuid, text, text[], integer, timestamptz
) to service_role;
grant execute on function public.manager_ai_get_workload(
  uuid, text, text[], integer, timestamptz
) to service_role;

comment on function public.manager_ai_get_jobs(
  uuid, text, text[], text[], text[], text[], boolean, integer, timestamptz
) is 'Approved bounded Manager AI job lookup with OR-within-filter and AND-across-filter semantics.';
comment on function public.manager_ai_get_technician_stats(
  uuid, text, text[], integer, timestamptz
) is 'Approved deterministic Manager AI technician completion aggregation with bounded named comparisons.';
comment on function public.manager_ai_get_workload(
  uuid, text, text[], integer, timestamptz
) is 'Approved deterministic Manager AI workload aggregation with bounded named comparisons.';
