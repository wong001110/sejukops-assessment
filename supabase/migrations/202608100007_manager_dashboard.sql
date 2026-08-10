-- Phase 5: compact, deterministic Manager KPI aggregation.
--
-- The foundation migration already supplies the access-path indexes used here:
-- service_reports(completed_at), service_reports(technician_id, completed_at),
-- orders(status), orders(assigned_technician_id), and
-- order_reschedules(created_at). Do not duplicate them without query-plan evidence.

create or replace function public.manager_dashboard_metrics(
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
  v_timezone constant text := 'Asia/Kuala_Lumpur';
  v_as_of_local timestamp without time zone;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_comparison_label text;
  v_bucket_step interval;
  v_summary jsonb;
  v_previous jsonb;
  v_comparison jsonb;
  v_trend jsonb;
  v_technicians jsonb;
  v_service_types jsonb;
  v_payload jsonb;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.role = 'MANAGER'
      and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;

  if p_period is null or p_period not in ('today', 'this_week', 'this_month') then
    raise exception 'INVALID_DASHBOARD_PERIOD' using errcode = '22023';
  end if;

  v_as_of_local := coalesce(p_as_of, pg_catalog.now()) at time zone v_timezone;
  case p_period
    when 'today' then
      v_current_start := pg_catalog.date_trunc('day', v_as_of_local) at time zone v_timezone;
      v_current_end := v_current_start + interval '1 day';
      v_previous_start := v_current_start - interval '1 day';
      v_previous_end := v_current_start;
      v_comparison_label := 'Yesterday';
      v_bucket_step := interval '1 hour';
    when 'this_week' then
      v_current_start := pg_catalog.date_trunc('week', v_as_of_local) at time zone v_timezone;
      v_current_end := v_current_start + interval '7 days';
      v_previous_start := v_current_start - interval '7 days';
      v_previous_end := v_current_start;
      v_comparison_label := 'Last Week';
      v_bucket_step := interval '1 day';
    when 'this_month' then
      v_current_start := pg_catalog.date_trunc('month', v_as_of_local) at time zone v_timezone;
      v_current_end := (pg_catalog.date_trunc('month', v_as_of_local) + interval '1 month')
        at time zone v_timezone;
      v_previous_start := (pg_catalog.date_trunc('month', v_as_of_local) - interval '1 month')
        at time zone v_timezone;
      v_previous_end := v_current_start;
      v_comparison_label := 'Last Month';
      v_bucket_step := interval '7 days';
  end case;

  select pg_catalog.jsonb_build_object(
    'completedJobs', count(*)::integer,
    'totalAmount', pg_catalog.round(coalesce(sum(sr.final_amount), 0), 2),
    'rescheduled', (
      select count(*)::integer
      from public.order_reschedules ors
      where ors.created_at >= v_current_start and ors.created_at < v_current_end
    ),
    'averageJobValue', case
      when count(*) = 0 then 0
      else pg_catalog.round(sum(sr.final_amount) / count(*), 2)
    end
  )
  into v_summary
  from public.service_reports sr
  join public.orders o on o.id = sr.order_id
  where sr.completed_at >= v_current_start
    and sr.completed_at < v_current_end
    and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED');

  select pg_catalog.jsonb_build_object(
    'completedJobs', count(*)::integer,
    'totalAmount', pg_catalog.round(coalesce(sum(sr.final_amount), 0), 2),
    'rescheduled', (
      select count(*)::integer
      from public.order_reschedules ors
      where ors.created_at >= v_previous_start and ors.created_at < v_previous_end
    ),
    'averageJobValue', case
      when count(*) = 0 then 0
      else pg_catalog.round(sum(sr.final_amount) / count(*), 2)
    end
  )
  into v_previous
  from public.service_reports sr
  join public.orders o on o.id = sr.order_id
  where sr.completed_at >= v_previous_start
    and sr.completed_at < v_previous_end
    and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED');

  select pg_catalog.jsonb_object_agg(metric_name, pg_catalog.jsonb_build_object(
    'current', current_value,
    'previous', previous_value,
    'percentChange', case
      when previous_value = 0 and current_value = 0 then 0
      when previous_value = 0 then null
      else pg_catalog.round(((current_value - previous_value) / previous_value) * 100, 2)
    end
  ))
  into v_comparison
  from (values
    ('completedJobs', (v_summary ->> 'completedJobs')::numeric,
      (v_previous ->> 'completedJobs')::numeric),
    ('totalAmount', (v_summary ->> 'totalAmount')::numeric,
      (v_previous ->> 'totalAmount')::numeric),
    ('rescheduled', (v_summary ->> 'rescheduled')::numeric,
      (v_previous ->> 'rescheduled')::numeric),
    ('averageJobValue', (v_summary ->> 'averageJobValue')::numeric,
      (v_previous ->> 'averageJobValue')::numeric)
  ) comparisons(metric_name, current_value, previous_value);

  with buckets as (
    select
      bucket_start,
      least(bucket_start + v_bucket_step, v_current_end) as bucket_end,
      row_number() over (order by bucket_start) as bucket_number
    from pg_catalog.generate_series(
      v_current_start,
      v_current_end - interval '1 microsecond',
      v_bucket_step
    ) as series(bucket_start)
  ), bucket_values as (
    select
      b.bucket_start,
      b.bucket_number,
      case
        when p_period = 'today' then
          pg_catalog.to_char(b.bucket_start at time zone v_timezone, 'HH24:00')
        when p_period = 'this_week' then
          case extract(isodow from b.bucket_start at time zone v_timezone)::integer
            when 1 then 'Mon' when 2 then 'Tue' when 3 then 'Wed'
            when 4 then 'Thu' when 5 then 'Fri' when 6 then 'Sat' else 'Sun'
          end
        else 'Week ' || b.bucket_number::text
      end as label,
      count(sr.id)::integer as jobs,
      pg_catalog.round(coalesce(sum(sr.final_amount), 0), 2) as amount
    from buckets b
    left join (
      public.service_reports sr
      join public.orders o
        on o.id = sr.order_id and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
    ) on sr.completed_at >= b.bucket_start and sr.completed_at < b.bucket_end
    group by b.bucket_start, b.bucket_number
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('label', label, 'jobs', jobs, 'amount', amount)
    order by bucket_start
  ), '[]'::jsonb)
  into v_trend
  from bucket_values;

  with completed as (
    select
      sr.technician_id,
      count(*)::integer as jobs,
      pg_catalog.round(sum(sr.final_amount), 2) as amount
    from public.service_reports sr
    join public.orders o on o.id = sr.order_id
    where sr.completed_at >= v_current_start
      and sr.completed_at < v_current_end
      and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
    group by sr.technician_id
  ), rescheduled as (
    -- order_reschedules has no historical technician snapshot, so an event is
    -- attributed to the order's currently assigned technician.
    select o.assigned_technician_id as technician_id, count(*)::integer as rescheduled
    from public.order_reschedules ors
    join public.orders o on o.id = ors.order_id
    where ors.created_at >= v_current_start
      and ors.created_at < v_current_end
      and o.assigned_technician_id is not null
    group by o.assigned_technician_id
  ), combined as (
    select
      coalesce(c.technician_id, r.technician_id) as technician_id,
      coalesce(c.jobs, 0) as jobs,
      coalesce(c.amount, 0) as amount,
      coalesce(r.rescheduled, 0) as rescheduled
    from completed c
    full join rescheduled r on r.technician_id = c.technician_id
  ), ranked as (
    select
      row_number() over (
        order by c.jobs desc, c.amount desc, c.rescheduled desc,
          p.display_name asc, c.technician_id
      )::integer as rank,
      c.technician_id,
      p.display_name as name,
      c.jobs,
      c.amount,
      case when c.jobs = 0 then 0
        else pg_catalog.round(c.amount / c.jobs, 2) end as average_job_value,
      c.rescheduled
    from combined c
    join public.technicians t on t.id = c.technician_id
    join public.profiles p on p.id = t.profile_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'rank', rank,
    'technicianId', technician_id,
    'name', name,
    'jobs', jobs,
    'amount', amount,
    'averageJobValue', average_job_value,
    'rescheduled', rescheduled
  ) order by rank), '[]'::jsonb)
  into v_technicians
  from ranked;

  with distributions as (
    select
      o.service_type,
      count(*)::integer as completed_count,
      pg_catalog.round(sum(sr.final_amount), 2) as amount
    from public.service_reports sr
    join public.orders o on o.id = sr.order_id
    where sr.completed_at >= v_current_start
      and sr.completed_at < v_current_end
      and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
    group by o.service_type
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'type', service_type,
    'count', completed_count,
    'amount', amount,
    'sharePercent', case
      when (v_summary ->> 'completedJobs')::numeric = 0 then 0
      else pg_catalog.round(
        completed_count::numeric / (v_summary ->> 'completedJobs')::numeric * 100,
        2
      )
    end
  ) order by completed_count desc, service_type asc), '[]'::jsonb)
  into v_service_types
  from distributions;

  v_payload := pg_catalog.jsonb_build_object(
    'period', p_period,
    'timezone', v_timezone,
    'range', pg_catalog.jsonb_build_object(
      'currentStart', pg_catalog.to_char(v_current_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'currentEnd', pg_catalog.to_char(v_current_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'comparisonStart', pg_catalog.to_char(v_previous_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'comparisonEnd', pg_catalog.to_char(v_previous_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'comparisonLabel', v_comparison_label
    ),
    'summary', v_summary,
    'comparison', v_comparison,
    'trend', v_trend,
    'technicians', v_technicians,
    'serviceTypes', v_service_types
  );

  return v_payload || pg_catalog.jsonb_build_object(
    'metricsVersion', p_period || ':' || pg_catalog.md5(v_payload::text)
  );
end;
$$;

comment on function public.manager_dashboard_metrics(uuid, text, timestamptz) is
  'Manager-only compact KPI aggregation. p_as_of is for deterministic verification only.';

revoke all on function public.manager_dashboard_metrics(uuid, text, timestamptz) from public;
revoke all on function public.manager_dashboard_metrics(uuid, text, timestamptz) from anon;
revoke all on function public.manager_dashboard_metrics(uuid, text, timestamptz) from authenticated;
grant execute on function public.manager_dashboard_metrics(uuid, text, timestamptz) to service_role;
