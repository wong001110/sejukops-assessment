-- Phase 2 transactional Admin order, assignment, and reschedule workflow.
-- The assessment uses mock application auth, so these narrowly scoped RPCs are
-- callable only by the server-side service role. Each function independently
-- validates the supplied active Admin profile before writing business data.

create unique index if not exists customers_normalized_phone_unique_idx
on public.customers ((regexp_replace(phone, '[^0-9]', '', 'g')));

create sequence if not exists public.order_number_sequence as bigint start with 1;
revoke all on sequence public.order_number_sequence from public, anon, authenticated;

select pg_catalog.setval(
  'public.order_number_sequence',
  coalesce(max(split_part(order_no, '-', 3)::bigint), 1),
  count(*) > 0
)
from public.orders;

create or replace function public.admin_create_order(
  p_actor_profile_id uuid,
  p_request_key uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_branch_id uuid,
  p_technician_id uuid,
  p_scheduled_at timestamptz,
  p_problem_description text,
  p_service_type text,
  p_quoted_price numeric,
  p_admin_notes text
)
returns table (order_id uuid, customer_reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_order_no text;
  v_customer_reused boolean := false;
  v_audit_key text := 'order:create:' || p_request_key::text;
  v_existing_signature text;
  v_payload_signature text := md5(jsonb_build_object(
    'customerId', p_customer_id,
    'customerName', btrim(p_customer_name),
    'customerPhone', regexp_replace(p_customer_phone, '[^0-9]', '', 'g'),
    'customerAddress', btrim(p_customer_address),
    'branchId', p_branch_id,
    'technicianId', p_technician_id,
    'scheduledAt', p_scheduled_at,
    'problemDescription', btrim(p_problem_description),
    'serviceType', btrim(p_service_type),
    'quotedPrice', p_quoted_price,
    'adminNotes', nullif(btrim(p_admin_notes), '')
  )::text);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));

  select
    a.order_id,
    coalesce((a.metadata_json ->> 'customerReused')::boolean, false),
    a.metadata_json ->> 'payloadSignature'
  into v_order_id, v_customer_reused, v_existing_signature
  from public.audit_logs a
  where a.idempotency_key = v_audit_key;

  if v_order_id is not null then
    if v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_order_id, v_customer_reused;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then
    raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.active
  ) then
    raise exception 'INVALID_BRANCH' using errcode = 'P0001';
  end if;

  if p_customer_id is not null then
    select c.id into v_customer_id
    from public.customers c
    where c.id = p_customer_id;
    if v_customer_id is null then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_customer_reused := true;
  else
    select c.id into v_customer_id
    from public.customers c
    where regexp_replace(c.phone, '[^0-9]', '', 'g') =
      regexp_replace(p_customer_phone, '[^0-9]', '', 'g')
    limit 1;

    if v_customer_id is not null then
      update public.customers
      set name = btrim(p_customer_name),
          address = btrim(p_customer_address),
          phone = btrim(p_customer_phone)
      where id = v_customer_id;
      v_customer_reused := true;
    else
      v_customer_id := gen_random_uuid();
      begin
        insert into public.customers (id, name, phone, address)
        values (
          v_customer_id,
          btrim(p_customer_name),
          btrim(p_customer_phone),
          btrim(p_customer_address)
        );
      exception when unique_violation then
        select c.id into v_customer_id
        from public.customers c
        where regexp_replace(c.phone, '[^0-9]', '', 'g') =
          regexp_replace(p_customer_phone, '[^0-9]', '', 'g')
        limit 1;
        v_customer_reused := true;
      end;
    end if;
  end if;

  if p_technician_id is not null and not exists (
    select 1 from public.technicians t
    join public.profiles p on p.id = t.profile_id
    where t.id = p_technician_id
      and t.branch_id = p_branch_id
      and t.active
      and p.active
  ) then
    raise exception 'TECHNICIAN_BRANCH_MISMATCH' using errcode = 'P0001';
  end if;

  loop
    v_order_no := 'ORD-' ||
      to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY') || '-' ||
      lpad(nextval('public.order_number_sequence')::text, 4, '0');
    exit when not exists (select 1 from public.orders o where o.order_no = v_order_no);
  end loop;

  v_order_id := gen_random_uuid();
  insert into public.orders (
    id, order_no, branch_id, customer_id, assigned_technician_id,
    problem_description, service_type, quoted_price, status, admin_notes,
    scheduled_at, created_by
  )
  values (
    v_order_id,
    v_order_no,
    p_branch_id,
    v_customer_id,
    p_technician_id,
    btrim(p_problem_description),
    btrim(p_service_type),
    p_quoted_price,
    case when p_technician_id is null then 'NEW'::public.order_status
      else 'ASSIGNED'::public.order_status end,
    nullif(btrim(p_admin_notes), ''),
    p_scheduled_at,
    p_actor_profile_id
  );

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
  )
  values (
    gen_random_uuid(),
    v_order_id,
    p_actor_profile_id,
    'ORDER_CREATED',
    v_audit_key,
    jsonb_build_object(
      'orderNo', v_order_no,
      'customerReused', v_customer_reused,
      'payloadSignature', v_payload_signature,
      'branchId', p_branch_id,
      'scheduledAt', p_scheduled_at
    )
  );

  if p_technician_id is not null then
    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    )
    values (
      gen_random_uuid(),
      v_order_id,
      p_actor_profile_id,
      'TECHNICIAN_ASSIGNED',
      'order:assign:' || p_request_key::text,
      jsonb_build_object('technicianId', p_technician_id, 'branchId', p_branch_id)
    );
  end if;

  return query select v_order_id, v_customer_reused;
end;
$$;

create or replace function public.admin_direct_reschedule_order(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_new_schedule timestamptz,
  p_reason text,
  p_request_key uuid
)
returns table (order_id uuid, reschedule_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_key text := 'order:reschedule:' || p_request_key::text;
  v_payload_signature text := md5(jsonb_build_object(
    'orderId', p_order_id,
    'newSchedule', p_new_schedule,
    'reason', nullif(btrim(p_reason), '')
  )::text);
  v_existing_signature text;
  v_existing_order_id uuid;
  v_existing_reschedule_id uuid;
  v_previous_schedule timestamptz;
  v_reschedule_id uuid;
  v_order_no text;
  v_technician_profile_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));

  select
    a.order_id,
    (a.metadata_json ->> 'rescheduleId')::uuid,
    a.metadata_json ->> 'payloadSignature'
  into v_existing_order_id, v_existing_reschedule_id, v_existing_signature
  from public.audit_logs a
  where a.idempotency_key = v_audit_key;

  if v_existing_order_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_existing_reschedule_id;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then
    raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001';
  end if;

  select o.scheduled_at, o.order_no, t.profile_id
  into v_previous_schedule, v_order_no, v_technician_profile_id
  from public.orders o
  left join public.technicians t on t.id = o.assigned_technician_id
  where o.id = p_order_id
  for update of o;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_previous_schedule is not distinct from p_new_schedule then
    raise exception 'SCHEDULE_UNCHANGED' using errcode = 'P0001';
  end if;

  v_reschedule_id := gen_random_uuid();
  insert into public.order_reschedules (
    id, order_id, previous_schedule, new_schedule, reason, source,
    source_request_id, created_by
  )
  values (
    v_reschedule_id, p_order_id, v_previous_schedule, p_new_schedule,
    nullif(btrim(p_reason), ''), 'DIRECT_ADMIN', null, p_actor_profile_id
  );

  update public.orders set scheduled_at = p_new_schedule where id = p_order_id;

  if v_technician_profile_id is not null then
    insert into public.internal_notifications (
      id, recipient_profile_id, order_id, business_key, title, message
    )
    values (
      gen_random_uuid(),
      v_technician_profile_id,
      p_order_id,
      'reschedule:' || v_reschedule_id::text,
      'Schedule updated for ' || v_order_no,
      'The Admin updated this job schedule. Open the job to review the new time.'
    )
    on conflict (recipient_profile_id, business_key) do nothing;
  end if;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
  )
  values (
    gen_random_uuid(),
    p_order_id,
    p_actor_profile_id,
    'ORDER_RESCHEDULED',
    v_audit_key,
    jsonb_build_object(
      'rescheduleId', v_reschedule_id,
      'payloadSignature', v_payload_signature,
      'source', 'DIRECT_ADMIN',
      'previousSchedule', v_previous_schedule,
      'newSchedule', p_new_schedule
    )
  );

  return query select p_order_id, v_reschedule_id;
end;
$$;

create or replace function public.admin_resolve_reschedule_request(
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_decision text,
  p_resolution_note text,
  p_new_schedule timestamptz,
  p_request_key uuid
)
returns table (order_id uuid, reschedule_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_key text := 'reschedule-request:resolve:' || p_request_key::text;
  v_payload_signature text := md5(jsonb_build_object(
    'requestId', p_request_id,
    'decision', p_decision,
    'resolutionNote', nullif(btrim(p_resolution_note), ''),
    'newSchedule', p_new_schedule
  )::text);
  v_existing_signature text;
  v_existing_order_id uuid;
  v_existing_request_id uuid;
  v_existing_reschedule_id uuid;
  v_order_id uuid;
  v_request_status public.reschedule_request_status;
  v_requested_schedule timestamptz;
  v_request_reason text;
  v_effective_schedule timestamptz;
  v_previous_schedule timestamptz;
  v_reschedule_id uuid;
  v_order_no text;
  v_technician_profile_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));

  select
    a.order_id,
    (a.metadata_json ->> 'requestId')::uuid,
    nullif(a.metadata_json ->> 'rescheduleId', '')::uuid,
    a.metadata_json ->> 'payloadSignature'
  into v_existing_order_id, v_existing_request_id, v_existing_reschedule_id, v_existing_signature
  from public.audit_logs a
  where a.idempotency_key = v_audit_key;

  if v_existing_order_id is not null then
    if v_existing_request_id <> p_request_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_existing_reschedule_id;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then
    raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001';
  end if;

  select r.order_id, r.status, r.requested_schedule, r.reason
  into v_order_id, v_request_status, v_requested_schedule, v_request_reason
  from public.order_reschedule_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_request_status <> 'PENDING' then
    raise exception 'REQUEST_ALREADY_RESOLVED' using errcode = 'P0001';
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    raise exception 'INVALID_DECISION' using errcode = 'P0001';
  end if;

  select o.scheduled_at, o.order_no, t.profile_id
  into v_previous_schedule, v_order_no, v_technician_profile_id
  from public.orders o
  left join public.technicians t on t.id = o.assigned_technician_id
  where o.id = v_order_id
  for update of o;

  if p_decision = 'APPROVE' then
    v_effective_schedule := coalesce(p_new_schedule, v_requested_schedule);
    if v_effective_schedule is null then
      raise exception 'APPROVAL_REQUIRES_SCHEDULE' using errcode = 'P0001';
    end if;
    if v_previous_schedule is not distinct from v_effective_schedule then
      raise exception 'SCHEDULE_UNCHANGED' using errcode = 'P0001';
    end if;

    v_reschedule_id := gen_random_uuid();
    insert into public.order_reschedules (
      id, order_id, previous_schedule, new_schedule, reason, source,
      source_request_id, created_by
    )
    values (
      v_reschedule_id,
      v_order_id,
      v_previous_schedule,
      v_effective_schedule,
      v_request_reason,
      'TECHNICIAN_REQUEST',
      p_request_id,
      p_actor_profile_id
    );

    update public.orders set scheduled_at = v_effective_schedule where id = v_order_id;
    update public.order_reschedule_requests
    set status = 'APPROVED',
        resolved_by = p_actor_profile_id,
        resolution_note = nullif(btrim(p_resolution_note), ''),
        resolved_at = now()
    where id = p_request_id;

    if v_technician_profile_id is not null then
      insert into public.internal_notifications (
        id, recipient_profile_id, order_id, business_key, title, message
      )
      values (
        gen_random_uuid(),
        v_technician_profile_id,
        v_order_id,
        'reschedule:' || v_reschedule_id::text,
        'Reschedule request approved for ' || v_order_no,
        'The Admin approved the request. Open the job to review the updated schedule.'
      )
      on conflict (recipient_profile_id, business_key) do nothing;
    end if;

    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    )
    values (
      gen_random_uuid(),
      v_order_id,
      p_actor_profile_id,
      'ORDER_RESCHEDULED',
      v_audit_key,
      jsonb_build_object(
        'requestId', p_request_id,
        'rescheduleId', v_reschedule_id,
        'payloadSignature', v_payload_signature,
        'source', 'TECHNICIAN_REQUEST',
        'resolutionNote', nullif(btrim(p_resolution_note), ''),
        'previousSchedule', v_previous_schedule,
        'newSchedule', v_effective_schedule
      )
    );
  else
    update public.order_reschedule_requests
    set status = 'REJECTED',
        resolved_by = p_actor_profile_id,
        resolution_note = nullif(btrim(p_resolution_note), ''),
        resolved_at = now()
    where id = p_request_id;

    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    )
    values (
      gen_random_uuid(),
      v_order_id,
      p_actor_profile_id,
      'RESCHEDULE_REQUEST_REJECTED',
      v_audit_key,
      jsonb_build_object(
        'requestId', p_request_id,
        'decision', 'REJECT',
        'payloadSignature', v_payload_signature,
        'resolutionNote', nullif(btrim(p_resolution_note), '')
      )
    );
  end if;

  return query select v_order_id, v_reschedule_id;
end;
$$;

revoke all on function public.admin_create_order(
  uuid, uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, numeric, text
) from public, anon, authenticated;
revoke all on function public.admin_direct_reschedule_order(
  uuid, uuid, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.admin_resolve_reschedule_request(
  uuid, uuid, text, text, timestamptz, uuid
) from public, anon, authenticated;

grant execute on function public.admin_create_order(
  uuid, uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, numeric, text
) to service_role;
grant execute on function public.admin_direct_reschedule_order(
  uuid, uuid, timestamptz, text, uuid
) to service_role;
grant execute on function public.admin_resolve_reschedule_request(
  uuid, uuid, text, text, timestamptz, uuid
) to service_role;
