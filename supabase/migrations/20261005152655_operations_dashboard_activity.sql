-- Read only aggregate access to the private completion/scheduling audits.
-- Never expose actor/visit metadata, historical generations or unrelated jobs.
create function public.workspace_dashboard_activity(
  p_workspace_id uuid, p_expected_generation bigint, p_period text,
  p_guest_visit_id uuid default null, p_guest_token_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles; v_role public.app_role; v_kind public.workspace_kind;
  v_generation bigint; v_preview private.owner_previews; v_technician uuid;
  v_effective_profile uuid; v_now timestamptz := clock_timestamp();
  v_start timestamptz; v_previous_start timestamptz; v_previous_end timestamptz;
  v_bucket interval; v_result jsonb;
begin
  if (select auth.uid()) is null or (select (auth.jwt()->>'is_anonymous')::boolean) is not false
    or p_period is null or p_period not in ('today','this_week','this_month')
    or not private.staff_current_actor_ready(p_workspace_id) then
    raise exception 'DASHBOARD_FORBIDDEN' using errcode='42501'; end if;
  select p.* into v_profile from public.profiles p where p.auth_user_id=(select auth.uid()) and p.active;
  select m.role,w.kind,w.generation into v_role,v_kind,v_generation
    from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id
    where m.profile_id=v_profile.id and m.workspace_id=p_workspace_id and m.active and w.active
    for share of w;
  if v_role is null or (v_profile.demo_principal and (v_kind<>'DEMO' or v_profile.role<>v_role)) then
    raise exception 'DASHBOARD_FORBIDDEN' using errcode='42501'; end if;
  if p_expected_generation is null or p_expected_generation<>v_generation then
    raise exception 'DASHBOARD_GENERATION_STALE' using errcode='P0001'; end if;
  if v_profile.demo_principal then
    if p_guest_visit_id is null or p_guest_token_hash is null or not exists (
      select 1 from public.guest_visits g where g.id=p_guest_visit_id and g.token_hash=p_guest_token_hash
        and g.workspace_id=p_workspace_id and g.demo_generation=v_generation and g.persona=v_role
        and g.revoked_at is null and g.expires_at>v_now
    ) then raise exception 'DASHBOARD_GUEST_INVALID' using errcode='42501'; end if;
  elsif p_guest_visit_id is not null or p_guest_token_hash is not null then
    raise exception 'DASHBOARD_GUEST_FORBIDDEN' using errcode='42501'; end if;
  v_effective_profile := v_profile.id;
  select * into v_preview from private.owner_previews where session_id=private.staff_signed_session_id();
  if v_preview.id is not null then
    if v_preview.auth_user_id is distinct from (select auth.uid()) or v_preview.workspace_id<>p_workspace_id
      or not private.owner_preview_valid(v_preview.id) then
      raise exception 'DASHBOARD_PREVIEW_INVALID' using errcode='42501'; end if;
    v_role := v_preview.role; v_effective_profile := v_preview.effective_employee_profile_id;
  end if;
  if v_role='TECHNICIAN' then
    select t.id into v_technician from public.workspace_technicians t
      join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
      where t.workspace_id=p_workspace_id and t.profile_id=v_effective_profile and t.active and b.active;
  end if;
  v_start := date_trunc(case p_period when 'today' then 'day' when 'this_week' then 'week' else 'month' end,
    v_now at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur';
  v_previous_start := v_start - case p_period when 'today' then interval '1 day' when 'this_week' then interval '7 days' else interval '1 month' end;
  v_previous_end := least(v_start,v_previous_start + (v_now-v_start));
  v_bucket := case p_period when 'today' then interval '1 hour' else interval '1 day' end;
  with visible_orders as materialized (
    select o.id,o.assigned_technician_id from public.workspace_orders o where o.workspace_id=p_workspace_id
      and (v_role in ('ADMIN','MANAGER') or (v_role='TECHNICIAN' and o.assigned_technician_id=v_technician))
      and private.owner_preview_read_allowed(p_workspace_id,'orders',o.id)
  ), events as materialized (
    select a.order_id,a.occurred_at,'COMPLETED'::text kind,o.assigned_technician_id technician_id
      from private.workspace_order_activity_audit a join visible_orders o on o.id=a.order_id
      where a.workspace_id=p_workspace_id and a.workspace_generation=v_generation and a.to_status='COMPLETED'
        and a.occurred_at>=v_previous_start and a.occurred_at<v_now
    union all
    select a.order_id,a.occurred_at,'RESCHEDULED'::text,o.assigned_technician_id
      from private.workspace_order_schedule_audit a join visible_orders o on o.id=a.order_id
      where a.workspace_id=p_workspace_id and a.workspace_generation=v_generation
        and a.occurred_at>=v_previous_start and a.occurred_at<v_now
  ), buckets as (
    select bucket from generate_series(v_start,v_now,v_bucket) bucket where bucket<v_now
  ), visible_technicians as (
    select distinct t.id,p.display_name from visible_orders o
      join public.workspace_technicians t on t.workspace_id=p_workspace_id and t.id=o.assigned_technician_id
      join public.profiles p on p.id=t.profile_id
  ), technician_activity as (
    select technician_id,count(*) filter(where kind='COMPLETED') completed,
      count(*) filter(where kind='RESCHEDULED') rescheduled from events
      where occurred_at>=v_start and technician_id is not null group by technician_id
  )
  select jsonb_build_object('asOf',v_now,'generation',v_generation,
    'completed',(select count(*) from events where kind='COMPLETED' and occurred_at>=v_start),
    'rescheduled',(select count(*) from events where kind='RESCHEDULED' and occurred_at>=v_start),
    'previousCompleted',(select count(*) from events where kind='COMPLETED' and occurred_at>=v_previous_start and occurred_at<v_previous_end),
    'previousRescheduled',(select count(*) from events where kind='RESCHEDULED' and occurred_at>=v_previous_start and occurred_at<v_previous_end),
    'trend',coalesce((select jsonb_agg(jsonb_build_object('label',to_char(bucket at time zone 'Asia/Kuala_Lumpur',
      case p_period when 'today' then 'HH24:MI' else 'DD/MM' end),
      'jobs',(select count(*) from events where kind='COMPLETED' and occurred_at>=bucket and occurred_at<least(bucket+v_bucket,v_now))) order by bucket) from buckets),'[]'::jsonb),
    'technicians',coalesce((select jsonb_agg(jsonb_build_object('technicianId',t.id,'name',t.display_name,
      'completed',coalesce(a.completed,0),'rescheduled',coalesce(a.rescheduled,0)) order by coalesce(a.completed,0) desc,t.id)
      from visible_technicians t left join technician_activity a on a.technician_id=t.id),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.workspace_dashboard_activity(uuid,bigint,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.workspace_dashboard_activity(uuid,bigint,text,uuid,text) to authenticated;
