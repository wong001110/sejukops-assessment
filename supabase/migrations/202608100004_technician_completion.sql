-- Phase 3 Technician evidence staging and atomic completion.

create type public.service_evidence_upload_status as enum (
  'RESERVED', 'UPLOADED', 'ATTACHED', 'FAILED', 'ORPHANED', 'DELETING', 'DELETED'
);

create table public.service_evidence_uploads (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete restrict,
  upload_request_key uuid not null unique,
  payload_signature text not null,
  storage_bucket text not null default 'service-evidence'
    check (storage_bucket = 'service-evidence'),
  storage_path text not null unique,
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 78643200),
  status public.service_evidence_upload_status not null default 'RESERVED',
  service_attachment_id uuid unique references public.service_attachments(id) on delete cascade,
  failure_code text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attached_upload_has_attachment check (
    (status = 'ATTACHED' and service_attachment_id is not null)
    or (status <> 'ATTACHED' and service_attachment_id is null)
  ),
  constraint confirmed_upload_has_timestamp check (
    status not in ('UPLOADED', 'ATTACHED') or uploaded_at is not null
  )
);

create index service_evidence_uploads_order_status_idx
on public.service_evidence_uploads(order_id, status);

create trigger service_evidence_uploads_set_updated_at
before update on public.service_evidence_uploads
for each row execute function public.set_updated_at();

alter table public.service_evidence_uploads enable row level security;

alter table public.service_reports
add column completion_payload_signature text;

update storage.buckets
set public = false,
    file_size_limit = 78643200,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/pdf'
    ]
where id = 'service-evidence';

create or replace function public.technician_reserve_evidence_upload(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_request_key uuid
)
returns table (
  upload_id uuid,
  storage_path text,
  upload_status public.service_evidence_upload_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_existing_signature text;
  v_payload_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id,
    'orderId', p_order_id,
    'originalFilename', btrim(p_original_filename),
    'mimeType', p_mime_type,
    'sizeBytes', p_size_bytes
  )::text);
  v_upload_id uuid;
  v_storage_path text;
  v_upload_status public.service_evidence_upload_status;
  v_extension text;
  v_maximum_bytes bigint;
  v_active_count integer;
  v_active_bytes bigint;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('evidence:reserve:' || p_request_key::text, 0)
  );

  -- Current assignment/state is authoritative even for an exact replay. This
  -- check must precede any return that could cause the service to mint a new
  -- signed upload token for an existing RESERVED reservation.
  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_order_status
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_order_status <> 'IN_PROGRESS' then
    raise exception 'JOB_NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select u.id, u.storage_path, u.status, u.payload_signature
  into v_upload_id, v_storage_path, v_upload_status, v_existing_signature
  from public.service_evidence_uploads u
  where u.upload_request_key = p_request_key;
  if v_upload_id is not null then
    if v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_upload_status not in ('FAILED', 'ORPHANED') then
      return query select v_upload_id, v_storage_path, v_upload_status;
      return;
    end if;
  end if;

  v_maximum_bytes := case
    when p_mime_type in ('image/jpeg', 'image/png', 'image/webp') then 12582912
    when p_mime_type in ('video/mp4', 'video/quicktime', 'video/webm') then 78643200
    when p_mime_type = 'application/pdf' then 15728640
    else 0
  end;
  if v_maximum_bytes = 0 then
    raise exception 'EVIDENCE_MIME_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_size_bytes <= 0 or p_size_bytes > v_maximum_bytes then
    raise exception 'EVIDENCE_FILE_TOO_LARGE' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(u.size_bytes), 0)
  into v_active_count, v_active_bytes
  from public.service_evidence_uploads u
  where u.order_id = p_order_id
    and u.technician_id = v_technician_id
    and u.status in ('RESERVED', 'UPLOADED', 'ATTACHED', 'DELETING');
  if v_active_count >= 6 then
    raise exception 'EVIDENCE_FILE_COUNT_EXCEEDED' using errcode = 'P0001';
  end if;
  if v_active_bytes + p_size_bytes > 125829120 then
    raise exception 'EVIDENCE_TOTAL_SIZE_EXCEEDED' using errcode = 'P0001';
  end if;

  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'video/mp4' then 'mp4'
    when 'video/quicktime' then 'mov'
    when 'video/webm' then 'webm'
    when 'application/pdf' then 'pdf'
  end;
  if v_upload_id is null then
    v_upload_id := gen_random_uuid();
    v_storage_path := p_order_id::text || '/' || v_upload_id::text || '/evidence.' || v_extension;
    insert into public.service_evidence_uploads (
      id, order_id, technician_id, upload_request_key, payload_signature,
      storage_path, original_filename, mime_type, size_bytes
    )
    values (
      v_upload_id, p_order_id, v_technician_id, p_request_key, v_payload_signature,
      v_storage_path, btrim(p_original_filename), p_mime_type, p_size_bytes
    );
  else
    update public.service_evidence_uploads
    set status = 'RESERVED', failure_code = null, uploaded_at = null
    where id = v_upload_id;
  end if;

  return query select v_upload_id, v_storage_path, 'RESERVED'::public.service_evidence_upload_status;
end;
$$;

create or replace function public.technician_confirm_evidence_upload(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_upload_id uuid,
  p_request_key uuid,
  p_actual_mime_type text,
  p_actual_size_bytes bigint
)
returns table (upload_id uuid, upload_status public.service_evidence_upload_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_upload public.service_evidence_uploads%rowtype;
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

  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_order_status
  from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_order_status <> 'IN_PROGRESS' then
    raise exception 'JOB_NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select * into v_upload
  from public.service_evidence_uploads u
  where u.id = p_upload_id and u.order_id = p_order_id
  for update;
  if not found then
    raise exception 'EVIDENCE_UPLOAD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_upload.technician_id <> v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_upload.upload_request_key <> p_request_key then
    raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
  end if;
  if v_upload.status in ('UPLOADED', 'ATTACHED') then
    return query select v_upload.id, v_upload.status;
    return;
  end if;
  if v_upload.status <> 'RESERVED' then
    raise exception 'EVIDENCE_UPLOAD_NOT_CONFIRMABLE' using errcode = 'P0001';
  end if;

  if v_upload.mime_type <> p_actual_mime_type
    or v_upload.size_bytes <> p_actual_size_bytes then
    raise exception 'STORAGE_METADATA_MISMATCH' using errcode = 'P0001';
  end if;

  update public.service_evidence_uploads
  set status = 'UPLOADED', uploaded_at = now(), failure_code = null
  where id = p_upload_id;
  return query select p_upload_id, 'UPLOADED'::public.service_evidence_upload_status;
end;
$$;

create or replace function public.technician_mark_evidence_upload(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_upload_id uuid,
  p_target_status text,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_upload_status public.service_evidence_upload_status;
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
  if p_target_status not in ('FAILED', 'ORPHANED', 'DELETING', 'DELETED') then
    raise exception 'INVALID_EVIDENCE_STATUS' using errcode = 'P0001';
  end if;

  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_order_status
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_order_status <> 'IN_PROGRESS' then
    raise exception 'JOB_NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select u.status
  into v_upload_status
  from public.service_evidence_uploads u
  where u.id = p_upload_id
    and u.order_id = p_order_id
    and u.technician_id = v_technician_id
  for update;
  if not found then
    raise exception 'EVIDENCE_UPLOAD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_upload_status = 'ATTACHED' then
    raise exception 'ATTACHED_EVIDENCE_IMMUTABLE' using errcode = 'P0001';
  end if;

  update public.service_evidence_uploads
  set status = p_target_status::public.service_evidence_upload_status,
      failure_code = nullif(btrim(p_failure_code), '')
  where id = p_upload_id;
end;
$$;

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
    and p.role = 'TECHNICIAN'
    and p.active
    and t.active;
  if v_technician_id is null then
    raise exception 'INVALID_TECHNICIAN_ACTOR' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_audit_key, 0));
  select sr.id, sr.order_id, sr.technician_id, sr.completion_payload_signature,
    sr.completed_at,
    nullif(a.metadata_json ->> 'paymentId', '')::uuid
  into v_report_id, v_existing_order_id, v_existing_technician_id,
    v_existing_signature, v_completed_at, v_payment_id
  from public.service_reports sr
  join public.audit_logs a
    on a.order_id = sr.order_id and a.idempotency_key = v_audit_key
  where sr.completion_request_key = p_request_key::text;
  if v_report_id is not null then
    if v_existing_order_id <> p_order_id
      or v_existing_technician_id <> v_technician_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_existing_order_id, v_report_id, v_payment_id, v_completed_at;
    return;
  end if;

  select o.assigned_technician_id, o.status, o.quoted_price
  into v_assigned_technician_id, v_order_status, v_quoted_price
  from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
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

  -- Evidence reserved/uploaded by a previously assigned Technician is never
  -- eligible for this Technician's report. Mark it for cleanup while holding
  -- the order lock so it is identifiable but cannot block or be attached.
  update public.service_evidence_uploads u
  set status = 'ORPHANED', failure_code = 'TECHNICIAN_REASSIGNED'
  where u.order_id = p_order_id
    and u.technician_id <> v_technician_id
    and u.status in ('RESERVED', 'UPLOADED', 'DELETING');

  if exists (
    select 1 from public.service_evidence_uploads u
    where u.order_id = p_order_id
      and u.technician_id = v_technician_id
      and u.status in ('RESERVED', 'DELETING')
  ) then
    raise exception 'EVIDENCE_UPLOAD_PENDING' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.service_reports sr where sr.order_id = p_order_id) then
    raise exception 'JOB_ALREADY_COMPLETED' using errcode = 'P0001';
  end if;

  select min(a.created_at) into v_started_at
  from public.audit_logs a
  where a.order_id = p_order_id and a.event_type = 'JOB_STARTED';
  v_report_id := gen_random_uuid();
  v_completed_at := clock_timestamp();
  insert into public.service_reports (
    id, order_id, technician_id, work_done, extra_charges,
    quoted_price_snapshot, remarks, started_at, completed_at,
    completion_request_key, completion_payload_signature
  )
  values (
    v_report_id, p_order_id, v_technician_id, btrim(p_work_done),
    p_extra_charges, v_quoted_price, nullif(btrim(p_remarks), ''),
    v_started_at, v_completed_at, p_request_key::text, v_payload_signature
  );

  insert into public.service_attachments (
    id, service_report_id, storage_bucket, storage_path,
    original_filename, mime_type, size_bytes
  )
  select
    u.id, v_report_id, u.storage_bucket, u.storage_path,
    u.original_filename, u.mime_type, u.size_bytes
  from public.service_evidence_uploads u
  where u.order_id = p_order_id
    and u.technician_id = v_technician_id
    and u.status = 'UPLOADED'
  order by u.created_at;

  update public.service_evidence_uploads u
  set status = 'ATTACHED', service_attachment_id = u.id
  where u.order_id = p_order_id
    and u.technician_id = v_technician_id
    and u.status = 'UPLOADED';

  if p_payment_amount is not null then
    v_payment_id := gen_random_uuid();
    insert into public.payments (id, order_id, amount, method, recorded_by)
    values (v_payment_id, p_order_id, p_payment_amount, p_payment_method, p_actor_profile_id);
  end if;

  update public.orders set status = 'JOB_DONE' where id = p_order_id;
  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json, created_at
  )
  values (
    gen_random_uuid(), p_order_id, p_actor_profile_id, 'JOB_COMPLETED', v_audit_key,
    jsonb_build_object(
      'serviceReportId', v_report_id,
      'paymentId', v_payment_id,
      'payloadSignature', v_payload_signature
    ),
    v_completed_at
  );

  return query select p_order_id, v_report_id, v_payment_id, v_completed_at;
end;
$$;

revoke all on function public.technician_reserve_evidence_upload(
  uuid, uuid, text, text, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.technician_confirm_evidence_upload(
  uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.technician_mark_evidence_upload(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.technician_complete_job(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid
) from public, anon, authenticated;

grant execute on function public.technician_reserve_evidence_upload(
  uuid, uuid, text, text, bigint, uuid
) to service_role;
grant execute on function public.technician_confirm_evidence_upload(
  uuid, uuid, uuid, uuid, text, bigint
) to service_role;
grant execute on function public.technician_mark_evidence_upload(
  uuid, uuid, uuid, text, text
) to service_role;
grant execute on function public.technician_complete_job(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid
) to service_role;

comment on table public.service_evidence_uploads is
  'Database-authoritative upload workflow; Storage listing is used only to confirm an actual reserved object.';
