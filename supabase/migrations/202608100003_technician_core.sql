-- Phase 3 Technician core: assigned-job start and reschedule request.
-- Mock application authorization is enforced before these service-role-only
-- functions are called, and repeated here with assigned-Technician checks.

create unique index if not exists reschedule_requests_one_pending_per_requester_idx
on public.order_reschedule_requests (order_id, requested_by)
where status = 'PENDING';

create or replace function public.technician_start_job(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_request_key uuid
)
returns table (order_id uuid, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_status public.order_status;
  v_started_at timestamptz;
  v_existing_order_id uuid;
  v_existing_signature text;
  v_audit_key text := 'job:start:' || p_request_key::text;
  v_payload_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id,
    'orderId', p_order_id
  )::text);
begin
  select t.id into v_technician_id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.id = p_actor_profile_id
    and p.role = 'TECHNICIAN'
    and p.active
    and t.active;

  if v_technician_id is null then
    raise exception 'INVALID_TECHNICIAN_ACTOR' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));

  select
    a.order_id,
    a.metadata_json ->> 'payloadSignature',
    coalesce((a.metadata_json ->> 'startedAt')::timestamptz, a.created_at)
  into v_existing_order_id, v_existing_signature, v_started_at
  from public.audit_logs a
  where a.idempotency_key = v_audit_key;

  if v_existing_order_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_started_at;
    return;
  end if;

  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_status <> 'ASSIGNED' then
    raise exception 'JOB_NOT_STARTABLE' using errcode = 'P0001';
  end if;

  v_started_at := clock_timestamp();
  update public.orders set status = 'IN_PROGRESS' where id = p_order_id;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json, created_at
  )
  values (
    gen_random_uuid(),
    p_order_id,
    p_actor_profile_id,
    'JOB_STARTED',
    v_audit_key,
    jsonb_build_object(
      'startedAt', v_started_at,
      'payloadSignature', v_payload_signature
    ),
    v_started_at
  );

  return query select p_order_id, v_started_at;
end;
$$;

create or replace function public.technician_request_reschedule(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_requested_schedule timestamptz,
  p_reason text,
  p_request_key uuid
)
returns table (order_id uuid, reschedule_request_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_status public.order_status;
  v_order_no text;
  v_request_id uuid;
  v_existing_order_id uuid;
  v_existing_request_id uuid;
  v_existing_signature text;
  v_audit_key text := 'reschedule-request:create:' || p_request_key::text;
  v_payload_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id,
    'orderId', p_order_id,
    'requestedSchedule', p_requested_schedule,
    'reason', btrim(p_reason)
  )::text);
begin
  select t.id into v_technician_id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.id = p_actor_profile_id
    and p.role = 'TECHNICIAN'
    and p.active
    and t.active;

  if v_technician_id is null then
    raise exception 'INVALID_TECHNICIAN_ACTOR' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));

  select
    a.order_id,
    (a.metadata_json ->> 'rescheduleRequestId')::uuid,
    a.metadata_json ->> 'payloadSignature'
  into v_existing_order_id, v_existing_request_id, v_existing_signature
  from public.audit_logs a
  where a.idempotency_key = v_audit_key;

  if v_existing_order_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_existing_request_id;
    return;
  end if;

  select o.assigned_technician_id, o.status, o.order_no
  into v_assigned_technician_id, v_status, v_order_no
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_status not in ('ASSIGNED', 'IN_PROGRESS') then
    raise exception 'JOB_NOT_RESCHEDULABLE' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'RESCHEDULE_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.order_reschedule_requests r
    where r.order_id = p_order_id
      and r.requested_by = p_actor_profile_id
      and r.status = 'PENDING'
  ) then
    raise exception 'PENDING_REQUEST_EXISTS' using errcode = 'P0001';
  end if;

  v_request_id := gen_random_uuid();
  insert into public.order_reschedule_requests (
    id, order_id, requested_by, requested_schedule, reason, status
  )
  values (
    v_request_id,
    p_order_id,
    p_actor_profile_id,
    p_requested_schedule,
    btrim(p_reason),
    'PENDING'
  );

  insert into public.internal_notifications (
    id, recipient_profile_id, order_id, business_key, title, message
  )
  select
    gen_random_uuid(),
    p.id,
    p_order_id,
    'reschedule-request:' || v_request_id::text,
    'Reschedule request for ' || v_order_no,
    'A Technician requested a schedule change. Open the order to review the reason.'
  from public.profiles p
  where p.role in ('ADMIN', 'MANAGER') and p.active
  on conflict (recipient_profile_id, business_key) do nothing;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
  )
  values (
    gen_random_uuid(),
    p_order_id,
    p_actor_profile_id,
    'RESCHEDULE_REQUESTED',
    v_audit_key,
    jsonb_build_object(
      'rescheduleRequestId', v_request_id,
      'requestedSchedule', p_requested_schedule,
      'payloadSignature', v_payload_signature
    )
  );

  return query select p_order_id, v_request_id;
end;
$$;

revoke all on function public.technician_start_job(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.technician_request_reschedule(
  uuid, uuid, timestamptz, text, uuid
) from public, anon, authenticated;

grant execute on function public.technician_start_job(uuid, uuid, uuid)
to service_role;
grant execute on function public.technician_request_reschedule(
  uuid, uuid, timestamptz, text, uuid
) to service_role;
