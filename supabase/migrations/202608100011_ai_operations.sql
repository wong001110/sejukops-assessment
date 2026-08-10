-- Phase 7 controlled Manager AI tools and durable operational-insight cache.
-- The model never receives a database client or SQL string. Each approved RPC
-- validates an active Manager actor and returns a bounded purpose-built JSON shape.

create table public.ai_operational_insight_cache (
  period text not null check (period in ('today', 'this_week', 'this_month')),
  metrics_version text not null check (
    metrics_version ~ '^(today|this_week|this_month):[a-f0-9]{32}$'
  ),
  insight text not null check (btrim(insight) <> '' and char_length(insight) <= 4000),
  citations jsonb not null check (
    jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) between 1 and 50
  ),
  generated_at timestamptz not null default pg_catalog.now(),
  primary key (period, metrics_version)
);

alter table public.ai_operational_insight_cache enable row level security;

create or replace function public.manager_ai_period_bounds(
  p_period text,
  p_as_of timestamptz default pg_catalog.now()
)
returns table(start_at timestamptz, end_at timestamptz)
language plpgsql
set search_path = ''
stable
as $$
declare
  v_timezone constant text := 'Asia/Kuala_Lumpur';
  v_local_now timestamp without time zone := p_as_of at time zone v_timezone;
  v_local_start timestamp without time zone;
  v_local_end timestamp without time zone;
begin
  case p_period
    when 'today' then
      v_local_start := pg_catalog.date_trunc('day', v_local_now);
      v_local_end := v_local_start + interval '1 day';
    when 'this_week' then
      v_local_start := pg_catalog.date_trunc('week', v_local_now);
      v_local_end := v_local_start + interval '1 week';
    when 'last_week' then
      v_local_end := pg_catalog.date_trunc('week', v_local_now);
      v_local_start := v_local_end - interval '1 week';
    when 'this_month' then
      v_local_start := pg_catalog.date_trunc('month', v_local_now);
      v_local_end := v_local_start + interval '1 month';
    else
      raise exception 'INVALID_AI_OPERATIONS_PERIOD' using errcode = 'P0001';
  end case;

  start_at := v_local_start at time zone v_timezone;
  end_at := v_local_end at time zone v_timezone;
  return next;
end;
$$;

create or replace function public.manager_ai_get_jobs(
  p_actor_profile_id uuid,
  p_period text default null,
  p_technician_name text default null,
  p_status text default null,
  p_service_type text default null,
  p_order_number text default null,
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
  if p_period is null and p_order_number is null then
    raise exception 'AI_OPERATIONS_FILTER_REQUIRED' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in (
    'NEW', 'ASSIGNED', 'IN_PROGRESS', 'JOB_DONE', 'REVIEWED', 'CLOSED'
  ) then
    raise exception 'INVALID_AI_OPERATIONS_STATUS' using errcode = 'P0001';
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
    where (p_order_number is null or pg_catalog.upper(o.order_no) = pg_catalog.upper(p_order_number))
      and (p_technician_name is null or pg_catalog.lower(p.display_name) = pg_catalog.lower(btrim(p_technician_name)))
      and (p_status is null or o.status::text = p_status)
      and (p_service_type is null or pg_catalog.lower(o.service_type) = pg_catalog.lower(btrim(p_service_type)))
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
  p_technician_name text default null,
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
      and (p_technician_name is null or pg_catalog.lower(p.display_name) = pg_catalog.lower(btrim(p_technician_name)))
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

create or replace function public.manager_ai_get_operational_summary(
  p_actor_profile_id uuid,
  p_period text,
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
  v_completed_jobs integer;
  v_total_amount numeric;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;
  select b.start_at, b.end_at into v_start, v_end
  from public.manager_ai_period_bounds(p_period, p_as_of) b;
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(sr.final_amount), 0)::numeric
  into v_completed_jobs, v_total_amount
  from public.service_reports sr
  join public.orders o
    on o.id = sr.order_id
    and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
  where sr.completed_at >= v_start and sr.completed_at < v_end;

  return jsonb_build_object(
    'range', jsonb_build_object('start', v_start, 'end', v_end),
    'completedJobs', v_completed_jobs,
    'totalAmount', v_total_amount
  );
end;
$$;

create or replace function public.manager_ai_get_workload(
  p_actor_profile_id uuid,
  p_period text,
  p_technician_name text default null,
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
      and (p_technician_name is null or pg_catalog.lower(p.display_name) = pg_catalog.lower(btrim(p_technician_name)))
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

revoke all on table public.ai_operational_insight_cache from public, anon, authenticated;
grant select, insert, update on table public.ai_operational_insight_cache to service_role;

revoke all on function public.manager_ai_period_bounds(text, timestamptz) from public, anon, authenticated;
revoke all on function public.manager_ai_get_jobs(uuid, text, text, text, text, text, boolean, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.manager_ai_get_technician_stats(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.manager_ai_get_operational_summary(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.manager_ai_get_workload(uuid, text, text, integer, timestamptz) from public, anon, authenticated;

grant execute on function public.manager_ai_get_jobs(uuid, text, text, text, text, text, boolean, integer, timestamptz) to service_role;
grant execute on function public.manager_ai_get_technician_stats(uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.manager_ai_get_operational_summary(uuid, text, timestamptz) to service_role;
grant execute on function public.manager_ai_get_workload(uuid, text, text, integer, timestamptz) to service_role;

comment on table public.ai_operational_insight_cache is
  'Bounded AI commentary cache keyed only by authoritative dashboard period and metrics version; no conversation memory.';
comment on function public.manager_ai_get_jobs(uuid, text, text, text, text, text, boolean, integer, timestamptz) is
  'Approved bounded Manager AI job lookup. p_as_of is a deterministic verification seam and is never browser-controlled.';
comment on function public.manager_ai_get_technician_stats(uuid, text, text, integer, timestamptz) is
  'Approved deterministic Manager AI technician completion aggregation.';
comment on function public.manager_ai_get_operational_summary(uuid, text, timestamptz) is
  'Approved deterministic Manager AI operational summary aggregation.';
comment on function public.manager_ai_get_workload(uuid, text, text, integer, timestamptz) is
  'Approved deterministic Manager AI active workload aggregation.';
