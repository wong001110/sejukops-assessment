-- Phase 4: truthful WhatsApp preparation, Manager review, and Manager rescheduling.

create index if not exists notifications_order_channel_idx
on public.notifications(order_id, channel);

create index if not exists job_reviews_order_created_idx
on public.job_reviews(order_id, created_at desc);

create index if not exists order_reschedule_requests_status_created_idx
on public.order_reschedule_requests(status, created_at desc);

alter table public.service_reports
add column completion_revision integer not null default 1
check (completion_revision > 0);

-- Converge the deterministic pre-Phase-4 fixtures to the same revision-aware
-- business identity and authoritative template used by runtime preparation.
update public.notifications n
set business_key = 'completion:' || sr.id::text || ':revision:'
      || sr.completion_revision::text,
    recipient = case
      when pg_catalog.left(
        pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 1
      ) = '0'
      then '60' || pg_catalog.substr(
        pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 2
      )
      else pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g')
    end,
    message = 'Hi ' || c.name || E',\n\n'
      || 'Job ' || o.order_no || ' has been completed by Technician '
      || tp.display_name || ' at '
      || to_char(sr.completed_at at time zone 'Asia/Kuala_Lumpur',
        'DD Mon YYYY, HH12:MI AM')
      || E'.\nPlease check the service and leave feedback.\n\nThank you!'
from public.orders o
join public.customers c on c.id = o.customer_id
join public.service_reports sr on sr.order_id = o.id
join public.technicians t on t.id = sr.technician_id
join public.profiles tp on tp.id = t.profile_id
where n.order_id = o.id and n.channel = 'WHATSAPP'
  and n.business_key = 'CUSTOMER_JOB_COMPLETED'
  and pg_catalog.length(
    case
      when pg_catalog.left(
        pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 1
      ) = '0'
      then '60' || pg_catalog.substr(
        pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g'), 2
      )
      else pg_catalog.regexp_replace(c.phone, '[^0-9]', '', 'g')
    end
  ) between 8 and 15;

delete from public.notifications
where channel = 'WHATSAPP' and business_key = 'CUSTOMER_JOB_COMPLETED';

create or replace function public.prepare_completion_whatsapp(
  p_actor_profile_id uuid,
  p_order_id uuid
)
returns table (
  notification_id uuid,
  order_id uuid,
  recipient text,
  message text,
  notification_status public.notification_status,
  generated_at timestamptz,
  opened_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.app_role;
  v_actor_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_order_no text;
  v_customer_name text;
  v_customer_phone text;
  v_normalized_recipient text;
  v_technician_name text;
  v_completed_at timestamptz;
  v_report_id uuid;
  v_completion_revision integer;
  v_business_key text;
  v_message text;
begin
  select p.role into v_actor_role
  from public.profiles p
  where p.id = p_actor_profile_id and p.active;
  if v_actor_role is null then
    raise exception 'INVALID_NOTIFICATION_ACTOR' using errcode = 'P0001';
  end if;

  if v_actor_role = 'TECHNICIAN' then
    select t.id into v_actor_technician_id
    from public.technicians t
    where t.profile_id = p_actor_profile_id and t.active;
  elsif v_actor_role not in ('ADMIN', 'MANAGER') then
    raise exception 'INVALID_NOTIFICATION_ACTOR' using errcode = 'P0001';
  end if;

  select o.assigned_technician_id, o.status, o.order_no,
         c.name, c.phone, tp.display_name,
         sr.completed_at, sr.id, sr.completion_revision
  into v_assigned_technician_id, v_order_status, v_order_no,
       v_customer_name, v_customer_phone, v_technician_name,
       v_completed_at, v_report_id, v_completion_revision
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.service_reports sr on sr.order_id = o.id
  join public.technicians t on t.id = sr.technician_id
  join public.profiles tp on tp.id = t.profile_id
  where o.id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_actor_role = 'TECHNICIAN'
    and v_assigned_technician_id is distinct from v_actor_technician_id then
    raise exception 'NOTIFICATION_SCOPE_DENIED' using errcode = 'P0001';
  end if;
  if v_order_status not in ('JOB_DONE', 'REVIEWED', 'CLOSED')
    or v_completed_at is null then
    raise exception 'COMPLETION_NOTIFICATION_NOT_READY' using errcode = 'P0001';
  end if;

  v_business_key := 'completion:' || v_report_id::text
    || ':revision:' || v_completion_revision::text;
  v_normalized_recipient := pg_catalog.regexp_replace(v_customer_phone, '[^0-9]', '', 'g');
  if pg_catalog.left(v_normalized_recipient, 1) = '0' then
    v_normalized_recipient := '60' || pg_catalog.substr(v_normalized_recipient, 2);
  end if;
  if pg_catalog.length(v_normalized_recipient) < 8
    or pg_catalog.length(v_normalized_recipient) > 15 then
    raise exception 'INVALID_WHATSAPP_RECIPIENT' using errcode = 'P0001';
  end if;
  v_message := 'Hi ' || v_customer_name || E',\n\n'
    || 'Job ' || v_order_no || ' has been completed by Technician '
    || v_technician_name || ' at '
    || to_char(v_completed_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY, HH12:MI AM')
    || E'.\nPlease check the service and leave feedback.\n\nThank you!';

  insert into public.notifications (
    id, order_id, channel, business_key, recipient, message, status
  )
  values (
    gen_random_uuid(), p_order_id, 'WHATSAPP', v_business_key,
    v_normalized_recipient, v_message, 'READY'
  )
  on conflict on constraint notifications_order_id_channel_business_key_key
  do nothing;

  return query
  select n.id, n.order_id, n.recipient, n.message, n.status,
         n.generated_at, n.opened_at
  from public.notifications n
  where n.order_id = p_order_id
    and n.channel = 'WHATSAPP'
    and n.business_key = v_business_key;
end;
$$;

create or replace function public.open_completion_whatsapp(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_notification_id uuid,
  p_request_key uuid
)
returns table (
  notification_id uuid,
  order_id uuid,
  recipient text,
  message text,
  notification_status public.notification_status,
  generated_at timestamptz,
  opened_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.app_role;
  v_actor_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_audit_key text := 'whatsapp:open:' || p_notification_id::text
    || ':' || p_request_key::text;
  v_existing_order_id uuid;
  v_existing_notification_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_audit_key, 0)
  );

  select a.order_id, nullif(a.metadata_json ->> 'notificationId', '')::uuid
  into v_existing_order_id, v_existing_notification_id
  from public.audit_logs a where a.idempotency_key = v_audit_key;
  if v_existing_order_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_notification_id <> p_notification_id then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

  select p.role into v_actor_role
  from public.profiles p
  where p.id = p_actor_profile_id and p.active;
  if v_actor_role is null then
    raise exception 'INVALID_NOTIFICATION_ACTOR' using errcode = 'P0001';
  end if;
  if v_actor_role = 'TECHNICIAN' then
    select t.id into v_actor_technician_id
    from public.technicians t
    where t.profile_id = p_actor_profile_id and t.active;
  elsif v_actor_role not in ('ADMIN', 'MANAGER') then
    raise exception 'INVALID_NOTIFICATION_ACTOR' using errcode = 'P0001';
  end if;

  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_order_status
  from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_actor_role = 'TECHNICIAN'
    and v_assigned_technician_id is distinct from v_actor_technician_id then
    raise exception 'NOTIFICATION_SCOPE_DENIED' using errcode = 'P0001';
  end if;
  if v_order_status not in ('JOB_DONE', 'REVIEWED', 'CLOSED') then
    raise exception 'COMPLETION_NOTIFICATION_NOT_READY' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.notifications n
    join public.service_reports sr on sr.order_id = n.order_id
    where n.id = p_notification_id and n.order_id = p_order_id
      and n.channel = 'WHATSAPP'
      and n.business_key = 'completion:' || sr.id::text
        || ':revision:' || sr.completion_revision::text
  ) then
    raise exception 'NOTIFICATION_NOT_CURRENT' using errcode = 'P0001';
  end if;

  update public.notifications n
  set status = 'OPENED', opened_at = coalesce(n.opened_at, now())
  where n.id = p_notification_id
    and n.order_id = p_order_id
    and n.channel = 'WHATSAPP';
  if not found then
    raise exception 'NOTIFICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_existing_order_id is null then
    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    ) values (
      gen_random_uuid(), p_order_id, p_actor_profile_id,
      'WHATSAPP_ACTION_OPENED', v_audit_key,
      jsonb_build_object('notificationId', p_notification_id)
    );
  end if;

  return query
  select n.id, n.order_id, n.recipient, n.message, n.status,
         n.generated_at, n.opened_at
  from public.notifications n where n.id = p_notification_id;
end;
$$;

create or replace function public.manager_review_job(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_decision text,
  p_note text,
  p_request_key uuid
)
returns table (
  order_id uuid,
  review_id uuid,
  resulting_status public.order_status,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_key text := 'job-review:' || p_request_key::text;
  v_payload_signature text := md5(jsonb_build_object(
    'orderId', p_order_id,
    'decision', p_decision,
    'note', nullif(btrim(p_note), '')
  )::text);
  v_existing_order_id uuid;
  v_existing_review_id uuid;
  v_existing_signature text;
  v_existing_status public.order_status;
  v_order_status public.order_status;
  v_order_no text;
  v_technician_profile_id uuid;
  v_review_id uuid;
  v_review_decision public.review_decision;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_audit_key, 0)
  );

  select a.order_id,
         nullif(a.metadata_json ->> 'reviewId', '')::uuid,
         a.metadata_json ->> 'payloadSignature',
         (a.metadata_json ->> 'resultingStatus')::public.order_status
  into v_existing_order_id, v_existing_review_id,
       v_existing_signature, v_existing_status
  from public.audit_logs a where a.idempotency_key = v_audit_key;
  if v_existing_order_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    select o.status into v_order_status
    from public.orders o where o.id = v_existing_order_id;
    if v_order_status is distinct from v_existing_status then
      raise exception 'REVIEW_REVISION_SUPERSEDED' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_existing_review_id,
      v_existing_status, true;
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then
    raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001';
  end if;
  if p_decision not in ('APPROVE', 'REQUEST_CLARIFICATION') then
    raise exception 'INVALID_REVIEW_DECISION' using errcode = 'P0001';
  end if;
  if p_decision = 'REQUEST_CLARIFICATION'
    and nullif(btrim(p_note), '') is null then
    raise exception 'CLARIFICATION_NOTE_REQUIRED' using errcode = 'P0001';
  end if;

  select o.status, o.order_no, t.profile_id
  into v_order_status, v_order_no, v_technician_profile_id
  from public.orders o
  left join public.technicians t on t.id = o.assigned_technician_id
  where o.id = p_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order_status <> 'JOB_DONE' then
    raise exception 'ORDER_NOT_REVIEWABLE' using errcode = 'P0001';
  end if;

  v_review_id := gen_random_uuid();
  v_review_decision := case when p_decision = 'APPROVE'
    then 'APPROVED'::public.review_decision
    else 'CLARIFICATION_REQUESTED'::public.review_decision end;
  insert into public.job_reviews(
    id, order_id, reviewed_by, decision, note, created_at
  )
  values (
    v_review_id, p_order_id, p_actor_profile_id, v_review_decision,
    nullif(btrim(p_note), ''), clock_timestamp()
  );

  if p_decision = 'APPROVE' then
    update public.orders set status = 'REVIEWED' where id = p_order_id;
    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    ) values (
      gen_random_uuid(), p_order_id, p_actor_profile_id, 'JOB_REVIEWED',
      v_audit_key || ':reviewed', jsonb_build_object('reviewId', v_review_id)
    );
    update public.orders set status = 'CLOSED' where id = p_order_id;
    v_existing_status := 'CLOSED';
    insert into public.audit_logs (
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    ) values (
      gen_random_uuid(), p_order_id, p_actor_profile_id, 'JOB_CLOSED',
      v_audit_key || ':closed', jsonb_build_object('reviewId', v_review_id)
    );
  else
    update public.orders set status = 'IN_PROGRESS' where id = p_order_id;
    v_existing_status := 'IN_PROGRESS';
    -- A receipt remains referenced by the historical payment path, while its
    -- staging row becomes replaceable/retryable for the clarification revision.
    update public.payment_receipt_uploads r
    set status = 'ORPHANED', payment_id = null,
        failure_code = 'SUPERSEDED_BY_CLARIFICATION'
    where r.order_id = p_order_id and r.status = 'ATTACHED';
    if v_technician_profile_id is not null then
      insert into public.internal_notifications (
        id, recipient_profile_id, order_id, business_key, title, message
      ) values (
        gen_random_uuid(), v_technician_profile_id, p_order_id,
        'review-clarification:' || v_review_id::text,
        'Clarification requested for ' || v_order_no,
        'Manager note: ' || btrim(p_note)
      ) on conflict (recipient_profile_id, business_key) do nothing;
    end if;
  end if;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
  ) values (
    gen_random_uuid(), p_order_id, p_actor_profile_id,
    case when p_decision = 'APPROVE' then 'JOB_REVIEW_APPROVED'
      else 'JOB_CLARIFICATION_REQUESTED' end,
    v_audit_key,
    jsonb_build_object(
      'reviewId', v_review_id,
      'payloadSignature', v_payload_signature,
      'decision', p_decision,
      'resultingStatus', v_existing_status,
      'note', nullif(btrim(p_note), '')
    )
  );

  return query select p_order_id, v_review_id, v_existing_status, false;
end;
$$;

create or replace function public.manager_direct_reschedule_order(
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
    'orderId', p_order_id, 'newSchedule', p_new_schedule,
    'reason', nullif(btrim(p_reason), ''), 'source', 'DIRECT_MANAGER'
  )::text);
  v_existing_order_id uuid;
  v_existing_reschedule_id uuid;
  v_existing_signature text;
  v_previous_schedule timestamptz;
  v_reschedule_id uuid;
  v_order_no text;
  v_technician_profile_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));
  select a.order_id, nullif(a.metadata_json ->> 'rescheduleId', '')::uuid,
         a.metadata_json ->> 'payloadSignature'
  into v_existing_order_id, v_existing_reschedule_id, v_existing_signature
  from public.audit_logs a where a.idempotency_key = v_audit_key;
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
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001'; end if;

  select o.scheduled_at, o.order_no, t.profile_id
  into v_previous_schedule, v_order_no, v_technician_profile_id
  from public.orders o
  left join public.technicians t on t.id = o.assigned_technician_id
  where o.id = p_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_previous_schedule is not distinct from p_new_schedule then
    raise exception 'SCHEDULE_UNCHANGED' using errcode = 'P0001';
  end if;

  v_reschedule_id := gen_random_uuid();
  insert into public.order_reschedules(
    id, order_id, previous_schedule, new_schedule, reason, source,
    source_request_id, created_by
  ) values (
    v_reschedule_id, p_order_id, v_previous_schedule, p_new_schedule,
    nullif(btrim(p_reason), ''), 'DIRECT_MANAGER', null, p_actor_profile_id
  );
  update public.orders set scheduled_at = p_new_schedule where id = p_order_id;
  if v_technician_profile_id is not null then
    insert into public.internal_notifications(
      id, recipient_profile_id, order_id, business_key, title, message
    ) values (
      gen_random_uuid(), v_technician_profile_id, p_order_id,
      'reschedule:' || v_reschedule_id::text,
      'Schedule updated for ' || v_order_no,
      'A Manager updated this job schedule. Open the job to review the new time.'
    ) on conflict (recipient_profile_id, business_key) do nothing;
  end if;
  insert into public.audit_logs(
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
  ) values (
    gen_random_uuid(), p_order_id, p_actor_profile_id, 'ORDER_RESCHEDULED',
    v_audit_key, jsonb_build_object(
      'rescheduleId', v_reschedule_id, 'payloadSignature', v_payload_signature,
      'source', 'DIRECT_MANAGER', 'previousSchedule', v_previous_schedule,
      'newSchedule', p_new_schedule
    )
  );
  return query select p_order_id, v_reschedule_id;
end;
$$;

create or replace function public.manager_resolve_reschedule_request(
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
    'requestId', p_request_id, 'decision', p_decision,
    'resolutionNote', nullif(btrim(p_resolution_note), ''),
    'newSchedule', p_new_schedule, 'resolverRole', 'MANAGER'
  )::text);
  v_existing_order_id uuid;
  v_existing_request_id uuid;
  v_existing_reschedule_id uuid;
  v_existing_signature text;
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
  select a.order_id, nullif(a.metadata_json ->> 'requestId', '')::uuid,
         nullif(a.metadata_json ->> 'rescheduleId', '')::uuid,
         a.metadata_json ->> 'payloadSignature'
  into v_existing_order_id, v_existing_request_id,
       v_existing_reschedule_id, v_existing_signature
  from public.audit_logs a where a.idempotency_key = v_audit_key;
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
    where p.id = p_actor_profile_id and p.role = 'MANAGER' and p.active
  ) then raise exception 'INVALID_MANAGER_ACTOR' using errcode = 'P0001'; end if;
  select r.order_id, r.status, r.requested_schedule, r.reason
  into v_order_id, v_request_status, v_requested_schedule, v_request_reason
  from public.order_reschedule_requests r where r.id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
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
  where o.id = v_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;

  if p_decision = 'APPROVE' then
    v_effective_schedule := coalesce(p_new_schedule, v_requested_schedule);
    if v_effective_schedule is null then
      raise exception 'APPROVAL_REQUIRES_SCHEDULE' using errcode = 'P0001';
    end if;
    if v_previous_schedule is not distinct from v_effective_schedule then
      raise exception 'SCHEDULE_UNCHANGED' using errcode = 'P0001';
    end if;
    v_reschedule_id := gen_random_uuid();
    insert into public.order_reschedules(
      id, order_id, previous_schedule, new_schedule, reason, source,
      source_request_id, created_by
    ) values (
      v_reschedule_id, v_order_id, v_previous_schedule, v_effective_schedule,
      v_request_reason, 'TECHNICIAN_REQUEST', p_request_id, p_actor_profile_id
    );
    update public.orders set scheduled_at = v_effective_schedule where id = v_order_id;
    update public.order_reschedule_requests set status = 'APPROVED',
      resolved_by = p_actor_profile_id,
      resolution_note = nullif(btrim(p_resolution_note), ''), resolved_at = now()
    where id = p_request_id;
    if v_technician_profile_id is not null then
      insert into public.internal_notifications(
        id, recipient_profile_id, order_id, business_key, title, message
      ) values (
        gen_random_uuid(), v_technician_profile_id, v_order_id,
        'reschedule:' || v_reschedule_id::text,
        'Reschedule request approved for ' || v_order_no,
        'A Manager approved the request. Open the job to review the updated schedule.'
      ) on conflict (recipient_profile_id, business_key) do nothing;
    end if;
    insert into public.audit_logs(
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    ) values (
      gen_random_uuid(), v_order_id, p_actor_profile_id, 'ORDER_RESCHEDULED',
      v_audit_key, jsonb_build_object(
        'requestId', p_request_id, 'rescheduleId', v_reschedule_id,
        'payloadSignature', v_payload_signature, 'source', 'TECHNICIAN_REQUEST',
        'resolverRole', 'MANAGER', 'previousSchedule', v_previous_schedule,
        'newSchedule', v_effective_schedule,
        'resolutionNote', nullif(btrim(p_resolution_note), '')
      )
    );
  else
    update public.order_reschedule_requests set status = 'REJECTED',
      resolved_by = p_actor_profile_id,
      resolution_note = nullif(btrim(p_resolution_note), ''), resolved_at = now()
    where id = p_request_id;
    if v_technician_profile_id is not null then
      insert into public.internal_notifications(
        id, recipient_profile_id, order_id, business_key, title, message
      ) values (
        gen_random_uuid(), v_technician_profile_id, v_order_id,
        'reschedule-request:rejected:' || p_request_id::text,
        'Reschedule request declined for ' || v_order_no,
        'A Manager declined the request. Open the job to review the decision.'
      ) on conflict (recipient_profile_id, business_key) do nothing;
    end if;
    insert into public.audit_logs(
      id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
    ) values (
      gen_random_uuid(), v_order_id, p_actor_profile_id,
      'RESCHEDULE_REQUEST_REJECTED', v_audit_key,
      jsonb_build_object(
        'requestId', p_request_id, 'payloadSignature', v_payload_signature,
        'decision', 'REJECT', 'resolverRole', 'MANAGER',
        'resolutionNote', nullif(btrim(p_resolution_note), '')
      )
    );
  end if;
  return query select v_order_id, v_reschedule_id;
end;
$$;

-- Clarification-aware completion revision. The canonical report remains unique
-- per order, while each accepted rework completion gets a monotonically
-- increasing revision and its own audit/notification business identity.
create or replace function public.technician_complete_job(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_work_done text,
  p_extra_charges numeric,
  p_remarks text,
  p_payment_amount numeric,
  p_payment_method public.payment_method,
  p_request_key uuid
)
returns table (
  order_id uuid,
  service_report_id uuid,
  payment_id uuid,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_quoted_price numeric(12,2);
  v_report_id uuid;
  v_payment_id uuid;
  v_completed_at timestamptz;
  v_started_at timestamptz;
  v_existing_order_id uuid;
  v_existing_technician_id uuid;
  v_existing_signature text;
  v_existing_revision integer;
  v_current_revision integer;
  v_prior_completed_at timestamptz;
  v_latest_review_decision public.review_decision;
  v_latest_review_at timestamptz;
  v_audit_key text := 'job:complete:' || p_request_key::text;
  v_payload_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id,
    'orderId', p_order_id,
    'workDone', btrim(p_work_done),
    'extraCharges', p_extra_charges,
    'remarks', nullif(btrim(p_remarks), ''),
    'paymentAmount', p_payment_amount,
    'paymentMethod', p_payment_method
  )::text);
begin
  select t.id into v_technician_id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.id = p_actor_profile_id
    and p.role = 'TECHNICIAN' and p.active and t.active;
  if v_technician_id is null then
    raise exception 'INVALID_TECHNICIAN_ACTOR' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_audit_key, 0)
  );
  select a.order_id,
         nullif(a.metadata_json ->> 'serviceReportId', '')::uuid,
         sr.technician_id,
         a.metadata_json ->> 'payloadSignature',
         nullif(a.metadata_json ->> 'paymentId', '')::uuid,
         a.created_at,
         coalesce(nullif(a.metadata_json ->> 'completionRevision', '')::integer, 1),
         sr.completion_revision
  into v_existing_order_id, v_report_id, v_existing_technician_id,
       v_existing_signature, v_payment_id, v_completed_at,
       v_existing_revision, v_current_revision
  from public.audit_logs a
  join public.service_reports sr
    on sr.id = nullif(a.metadata_json ->> 'serviceReportId', '')::uuid
  where a.idempotency_key = v_audit_key;
  if v_existing_order_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_technician_id <> v_technician_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_existing_revision <> v_current_revision then
      raise exception 'COMPLETION_REVISION_SUPERSEDED' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_report_id,
      v_payment_id, v_completed_at;
    return;
  end if;

  select o.assigned_technician_id, o.status, o.quoted_price
  into v_assigned_technician_id, v_order_status, v_quoted_price
  from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_order_status <> 'IN_PROGRESS' then
    raise exception 'JOB_NOT_COMPLETABLE' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_work_done), '') is null then
    raise exception 'WORK_DONE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_extra_charges < 0 then
    raise exception 'INVALID_EXTRA_CHARGES' using errcode = 'P0001';
  end if;
  if v_quoted_price + p_extra_charges > 9999999999.99 then
    raise exception 'INVALID_FINAL_AMOUNT' using errcode = 'P0001';
  end if;
  if (p_payment_amount is null) <> (p_payment_method is null) then
    raise exception 'INCOMPLETE_PAYMENT' using errcode = 'P0001';
  end if;
  if p_payment_amount is not null and p_payment_amount < 0 then
    raise exception 'INVALID_PAYMENT' using errcode = 'P0001';
  end if;

  update public.service_evidence_uploads u
  set status = 'ORPHANED', failure_code = 'TECHNICIAN_REASSIGNED'
  where u.order_id = p_order_id and u.technician_id <> v_technician_id
    and u.status in ('RESERVED', 'UPLOADED', 'DELETING');
  if exists (
    select 1 from public.service_evidence_uploads u
    where u.order_id = p_order_id and u.technician_id = v_technician_id
      and u.status in ('RESERVED', 'DELETING')
  ) then raise exception 'EVIDENCE_UPLOAD_PENDING' using errcode = 'P0001'; end if;

  select sr.id, sr.completion_revision, sr.completed_at
  into v_report_id, v_current_revision, v_prior_completed_at
  from public.service_reports sr where sr.order_id = p_order_id for update;
  if v_report_id is not null then
    select jr.decision, jr.created_at
    into v_latest_review_decision, v_latest_review_at
    from public.job_reviews jr
    where jr.order_id = p_order_id
    order by jr.created_at desc, jr.id desc limit 1;
    if v_latest_review_decision is distinct from 'CLARIFICATION_REQUESTED'
      or v_latest_review_at <= v_prior_completed_at then
      raise exception 'JOB_ALREADY_COMPLETED' using errcode = 'P0001';
    end if;
    v_current_revision := v_current_revision + 1;
    v_completed_at := clock_timestamp();
    update public.service_reports set
      technician_id = v_technician_id,
      work_done = btrim(p_work_done),
      extra_charges = p_extra_charges,
      quoted_price_snapshot = v_quoted_price,
      remarks = nullif(btrim(p_remarks), ''),
      completed_at = v_completed_at,
      completion_request_key = p_request_key::text,
      completion_payload_signature = v_payload_signature,
      completion_receipt_payload_signature = null,
      completion_revision = v_current_revision
    where id = v_report_id;
  else
    select min(a.created_at) into v_started_at
    from public.audit_logs a
    where a.order_id = p_order_id and a.event_type = 'JOB_STARTED';
    v_report_id := gen_random_uuid();
    v_current_revision := 1;
    v_completed_at := clock_timestamp();
    insert into public.service_reports(
      id, order_id, technician_id, work_done, extra_charges,
      quoted_price_snapshot, remarks, started_at, completed_at,
      completion_request_key, completion_payload_signature, completion_revision
    ) values (
      v_report_id, p_order_id, v_technician_id, btrim(p_work_done),
      p_extra_charges, v_quoted_price, nullif(btrim(p_remarks), ''),
      v_started_at, v_completed_at, p_request_key::text,
      v_payload_signature, v_current_revision
    );
  end if;

  insert into public.service_attachments(
    id, service_report_id, storage_bucket, storage_path,
    original_filename, mime_type, size_bytes
  )
  select u.id, v_report_id, u.storage_bucket, u.storage_path,
         u.original_filename, u.mime_type, u.size_bytes
  from public.service_evidence_uploads u
  where u.order_id = p_order_id and u.technician_id = v_technician_id
    and u.status = 'UPLOADED'
  order by u.created_at;
  update public.service_evidence_uploads u
  set status = 'ATTACHED', service_attachment_id = u.id
  where u.order_id = p_order_id and u.technician_id = v_technician_id
    and u.status = 'UPLOADED';

  if p_payment_amount is not null then
    v_payment_id := gen_random_uuid();
    insert into public.payments(id, order_id, amount, method, recorded_by)
    values (v_payment_id, p_order_id, p_payment_amount,
      p_payment_method, p_actor_profile_id);
  end if;
  update public.orders set status = 'JOB_DONE' where id = p_order_id;
  insert into public.audit_logs(
    id, order_id, actor_profile_id, event_type,
    idempotency_key, metadata_json, created_at
  ) values (
    gen_random_uuid(), p_order_id, p_actor_profile_id, 'JOB_COMPLETED',
    v_audit_key, jsonb_build_object(
      'serviceReportId', v_report_id,
      'paymentId', v_payment_id,
      'payloadSignature', v_payload_signature,
      'completionRevision', v_current_revision
    ), v_completed_at
  );
  return query select p_order_id, v_report_id, v_payment_id, v_completed_at;
end;
$$;

create or replace function public.technician_complete_job_with_receipt(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_work_done text,
  p_extra_charges numeric,
  p_remarks text,
  p_payment_amount numeric,
  p_payment_method public.payment_method,
  p_receipt_upload_id uuid,
  p_request_key uuid
)
returns table (
  order_id uuid,
  service_report_id uuid,
  payment_id uuid,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base record;
  v_report_signature text;
  v_receipt public.payment_receipt_uploads%rowtype;
  v_full_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id, 'orderId', p_order_id,
    'workDone', btrim(p_work_done), 'extraCharges', p_extra_charges,
    'remarks', nullif(btrim(p_remarks), ''),
    'paymentAmount', p_payment_amount, 'paymentMethod', p_payment_method,
    'receiptUploadId', p_receipt_upload_id
  )::text);
begin
  if p_receipt_upload_id is not null
    and (p_payment_amount is null or p_payment_method is null) then
    raise exception 'RECEIPT_REQUIRES_PAYMENT' using errcode = 'P0001';
  end if;
  select * into v_base from public.technician_complete_job(
    p_actor_profile_id, p_order_id, p_work_done, p_extra_charges,
    p_remarks, p_payment_amount, p_payment_method, p_request_key
  );
  select sr.completion_receipt_payload_signature into v_report_signature
  from public.service_reports sr where sr.id = v_base.service_report_id for update;
  if v_report_signature is not null then
    if v_report_signature is distinct from v_full_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_base.order_id, v_base.service_report_id,
      v_base.payment_id, v_base.completed_at;
    return;
  end if;

  update public.payment_receipt_uploads r
  set status = 'ORPHANED', payment_id = null,
      failure_code = 'TECHNICIAN_REASSIGNED'
  where r.order_id = p_order_id
    and r.technician_id <> (
      select o.assigned_technician_id from public.orders o where o.id = p_order_id
    ) and r.status in ('RESERVED', 'UPLOADED', 'DELETING', 'ATTACHED');
  if exists (
    select 1 from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.order_id = p_order_id
      and r.technician_id = o.assigned_technician_id
      and r.status in ('RESERVED', 'DELETING')
  ) then raise exception 'RECEIPT_UPLOAD_PENDING' using errcode = 'P0001'; end if;

  if p_receipt_upload_id is not null then
    select r.* into v_receipt
    from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.id = p_receipt_upload_id and r.order_id = p_order_id
      and r.technician_id = o.assigned_technician_id
    for update of r;
    if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_receipt.status <> 'UPLOADED' then
      raise exception 'RECEIPT_NOT_UPLOADED' using errcode = 'P0001';
    end if;
  elsif exists (
    select 1 from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.order_id = p_order_id
      and r.technician_id = o.assigned_technician_id
      and r.status = 'UPLOADED'
  ) then raise exception 'RECEIPT_SELECTION_REQUIRED' using errcode = 'P0001'; end if;

  if p_receipt_upload_id is not null then
    update public.payments set receipt_storage_path = v_receipt.storage_path
    where id = v_base.payment_id;
    if not found then raise exception 'RECEIPT_REQUIRES_PAYMENT' using errcode = 'P0001'; end if;
    update public.payment_receipt_uploads
    set status = 'ATTACHED', payment_id = v_base.payment_id, failure_code = null
    where id = p_receipt_upload_id;
  end if;
  update public.service_reports
  set completion_receipt_payload_signature = v_full_signature
  where id = v_base.service_report_id;
  return query select v_base.order_id, v_base.service_report_id,
    v_base.payment_id, v_base.completed_at;
end;
$$;

revoke all on function public.prepare_completion_whatsapp(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.open_completion_whatsapp(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.manager_review_job(uuid, uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.manager_direct_reschedule_order(
  uuid, uuid, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.manager_resolve_reschedule_request(
  uuid, uuid, text, text, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.technician_complete_job(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.technician_complete_job_with_receipt(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.prepare_completion_whatsapp(uuid, uuid)
to service_role;
grant execute on function public.open_completion_whatsapp(uuid, uuid, uuid, uuid)
to service_role;
grant execute on function public.manager_review_job(uuid, uuid, text, text, uuid)
to service_role;
grant execute on function public.manager_direct_reschedule_order(
  uuid, uuid, timestamptz, text, uuid
) to service_role;
grant execute on function public.manager_resolve_reschedule_request(
  uuid, uuid, text, text, timestamptz, uuid
) to service_role;
grant execute on function public.technician_complete_job_with_receipt(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid, uuid
) to service_role;

comment on function public.prepare_completion_whatsapp(uuid, uuid) is
  'Idempotently prepares one deep-link notification after a valid committed completion.';
comment on function public.manager_review_job(uuid, uuid, text, text, uuid) is
  'Atomically records Manager review, lifecycle transitions, audit, and clarification notice.';
