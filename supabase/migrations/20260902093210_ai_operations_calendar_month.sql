-- Extend every controlled Operations AI tool with two calendar-safe periods:
-- last_month and an explicit month:YYYY-MM. This helper is shared by all
-- approved RPCs, so the policy stays consistent across tools.

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
    when 'last_month' then
      v_local_end := pg_catalog.date_trunc('month', v_local_now);
      v_local_start := v_local_end - interval '1 month';
    else
      if p_period ~ '^month:(20[0-9]{2}|21[0-9]{2})-(0[1-9]|1[0-2])$' then
        v_local_start := pg_catalog.make_date(
          pg_catalog.substr(p_period, 7, 4)::integer,
          pg_catalog.substr(p_period, 12, 2)::integer,
          1
        )::timestamp;
        v_local_end := v_local_start + interval '1 month';
      else
        raise exception 'INVALID_AI_OPERATIONS_PERIOD' using errcode = 'P0001';
      end if;
  end case;

  start_at := v_local_start at time zone v_timezone;
  end_at := v_local_end at time zone v_timezone;
  return next;
end;
$$;

comment on function public.manager_ai_period_bounds(text, timestamptz) is
  'Converts a bounded Operations AI symbolic or month:YYYY-MM period into Malaysia-time timestamps.';
