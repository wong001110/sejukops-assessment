-- Optional private payment receipt staging and atomic completion binding.

create table public.payment_receipt_uploads (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete restrict,
  upload_request_key uuid not null unique,
  payload_signature text not null,
  storage_bucket text not null default 'service-evidence'
    check (storage_bucket = 'service-evidence'),
  storage_path text not null unique,
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 12582912),
  status public.service_evidence_upload_status not null default 'RESERVED',
  payment_id uuid unique references public.payments(id) on delete cascade,
  failure_code text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attached_receipt_has_payment check (
    (status = 'ATTACHED' and payment_id is not null)
    or (status <> 'ATTACHED' and payment_id is null)
  ),
  constraint confirmed_receipt_has_timestamp check (
    status not in ('UPLOADED', 'ATTACHED') or uploaded_at is not null
  )
);

create unique index payment_receipt_one_current_idx
on public.payment_receipt_uploads(order_id, technician_id)
where status in ('RESERVED', 'UPLOADED', 'ATTACHED', 'DELETING');

create trigger payment_receipt_uploads_set_updated_at
before update on public.payment_receipt_uploads
for each row execute function public.set_updated_at();

alter table public.payment_receipt_uploads enable row level security;

alter table public.service_reports
add column completion_receipt_payload_signature text;

create or replace function public.technician_reserve_payment_receipt(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_request_key uuid
)
returns table (
  receipt_id uuid,
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
  v_receipt_id uuid;
  v_storage_path text;
  v_upload_status public.service_evidence_upload_status;
  v_existing_signature text;
  v_extension text;
  v_payload_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id,
    'orderId', p_order_id,
    'originalFilename', btrim(p_original_filename),
    'mimeType', p_mime_type,
    'sizeBytes', p_size_bytes
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
    pg_catalog.hashtextextended('receipt:reserve:' || p_request_key::text, 0)
  );
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

  select r.id, r.storage_path, r.status, r.payload_signature
  into v_receipt_id, v_storage_path, v_upload_status, v_existing_signature
  from public.payment_receipt_uploads r
  where r.upload_request_key = p_request_key;
  if v_receipt_id is not null then
    if v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_upload_status not in ('FAILED', 'ORPHANED') then
      return query select v_receipt_id, v_storage_path, v_upload_status;
      return;
    end if;
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'RECEIPT_MIME_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_size_bytes <= 0 or p_size_bytes > 12582912 then
    raise exception 'RECEIPT_FILE_TOO_LARGE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.payment_receipt_uploads r
    where r.order_id = p_order_id
      and r.technician_id = v_technician_id
      and r.status in ('RESERVED', 'UPLOADED', 'ATTACHED', 'DELETING')
      and (v_receipt_id is null or r.id <> v_receipt_id)
  ) then
    raise exception 'RECEIPT_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  if v_receipt_id is null then
    v_receipt_id := gen_random_uuid();
    v_storage_path := p_order_id::text || '/receipts/' || v_receipt_id::text ||
      '/receipt.' || v_extension;
    insert into public.payment_receipt_uploads (
      id, order_id, technician_id, upload_request_key, payload_signature,
      storage_path, original_filename, mime_type, size_bytes
    )
    values (
      v_receipt_id, p_order_id, v_technician_id, p_request_key,
      v_payload_signature, v_storage_path, btrim(p_original_filename),
      p_mime_type, p_size_bytes
    );
  else
    update public.payment_receipt_uploads
    set status = 'RESERVED', failure_code = null, uploaded_at = null
    where id = v_receipt_id;
  end if;

  return query select v_receipt_id, v_storage_path,
    'RESERVED'::public.service_evidence_upload_status;
end;
$$;

create or replace function public.technician_confirm_payment_receipt(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_receipt_id uuid,
  p_request_key uuid,
  p_actual_mime_type text,
  p_actual_size_bytes bigint
)
returns table (receipt_id uuid, upload_status public.service_evidence_upload_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_technician_id uuid;
  v_assigned_technician_id uuid;
  v_order_status public.order_status;
  v_receipt public.payment_receipt_uploads%rowtype;
begin
  select t.id into v_technician_id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.id = p_actor_profile_id
    and p.role = 'TECHNICIAN' and p.active and t.active;
  if v_technician_id is null then
    raise exception 'INVALID_TECHNICIAN_ACTOR' using errcode = 'P0001';
  end if;
  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_order_status
  from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_order_status <> 'IN_PROGRESS' then
    raise exception 'JOB_NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select r.* into v_receipt
  from public.payment_receipt_uploads r
  where r.id = p_receipt_id and r.order_id = p_order_id
  for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_receipt.technician_id <> v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_receipt.upload_request_key <> p_request_key then
    raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
  end if;
  if v_receipt.status in ('UPLOADED', 'ATTACHED') then
    return query select v_receipt.id, v_receipt.status;
    return;
  end if;
  if v_receipt.status <> 'RESERVED' then
    raise exception 'RECEIPT_NOT_CONFIRMABLE' using errcode = 'P0001';
  end if;
  if v_receipt.mime_type <> p_actual_mime_type
    or v_receipt.size_bytes <> p_actual_size_bytes then
    raise exception 'STORAGE_METADATA_MISMATCH' using errcode = 'P0001';
  end if;

  update public.payment_receipt_uploads
  set status = 'UPLOADED', uploaded_at = now(), failure_code = null
  where id = p_receipt_id;
  return query select p_receipt_id, 'UPLOADED'::public.service_evidence_upload_status;
end;
$$;

create or replace function public.technician_mark_payment_receipt(
  p_actor_profile_id uuid,
  p_order_id uuid,
  p_receipt_id uuid,
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
  v_receipt_status public.service_evidence_upload_status;
begin
  select t.id into v_technician_id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.id = p_actor_profile_id
    and p.role = 'TECHNICIAN' and p.active and t.active;
  if v_technician_id is null then
    raise exception 'INVALID_TECHNICIAN_ACTOR' using errcode = 'P0001';
  end if;
  if p_target_status not in ('FAILED', 'ORPHANED', 'DELETING', 'DELETED') then
    raise exception 'INVALID_RECEIPT_STATUS' using errcode = 'P0001';
  end if;
  select o.assigned_technician_id, o.status
  into v_assigned_technician_id, v_order_status
  from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_assigned_technician_id is distinct from v_technician_id then
    raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if v_order_status <> 'IN_PROGRESS' then
    raise exception 'JOB_NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;
  select r.status into v_receipt_status
  from public.payment_receipt_uploads r
  where r.id = p_receipt_id and r.order_id = p_order_id
    and r.technician_id = v_technician_id
  for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_receipt_status = 'ATTACHED' then
    raise exception 'ATTACHED_RECEIPT_IMMUTABLE' using errcode = 'P0001';
  end if;
  update public.payment_receipt_uploads
  set status = p_target_status::public.service_evidence_upload_status,
      failure_code = nullif(btrim(p_failure_code), '')
  where id = p_receipt_id;
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
    'actorProfileId', p_actor_profile_id,
    'orderId', p_order_id,
    'workDone', btrim(p_work_done),
    'extraCharges', p_extra_charges,
    'remarks', nullif(btrim(p_remarks), ''),
    'paymentAmount', p_payment_amount,
    'paymentMethod', p_payment_method,
    'receiptUploadId', p_receipt_upload_id
  )::text);
begin
  if p_receipt_upload_id is not null
    and (p_payment_amount is null or p_payment_method is null) then
    raise exception 'RECEIPT_REQUIRES_PAYMENT' using errcode = 'P0001';
  end if;

  select * into v_base
  from public.technician_complete_job(
    p_actor_profile_id, p_order_id, p_work_done, p_extra_charges,
    p_remarks, p_payment_amount, p_payment_method, p_request_key
  );

  select sr.completion_receipt_payload_signature into v_report_signature
  from public.service_reports sr where sr.id = v_base.service_report_id
  for update;
  if v_report_signature is not null then
    if v_report_signature is distinct from v_full_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_base.order_id, v_base.service_report_id,
      v_base.payment_id, v_base.completed_at;
    return;
  end if;

  update public.payment_receipt_uploads r
  set status = 'ORPHANED', failure_code = 'TECHNICIAN_REASSIGNED'
  where r.order_id = p_order_id
    and r.technician_id <> (
      select o.assigned_technician_id from public.orders o where o.id = p_order_id
    )
    and r.status in ('RESERVED', 'UPLOADED', 'DELETING');

  if exists (
    select 1 from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.order_id = p_order_id
      and r.technician_id = o.assigned_technician_id
      and r.status in ('RESERVED', 'DELETING')
  ) then
    raise exception 'RECEIPT_UPLOAD_PENDING' using errcode = 'P0001';
  end if;

  if p_receipt_upload_id is not null then
    select r.* into v_receipt
    from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.id = p_receipt_upload_id
      and r.order_id = p_order_id
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
  ) then
    raise exception 'RECEIPT_SELECTION_REQUIRED' using errcode = 'P0001';
  end if;

  if p_receipt_upload_id is not null then
    update public.payments
    set receipt_storage_path = v_receipt.storage_path
    where id = v_base.payment_id;
    if not found then
      raise exception 'RECEIPT_REQUIRES_PAYMENT' using errcode = 'P0001';
    end if;
    update public.payment_receipt_uploads
    set status = 'ATTACHED', payment_id = v_base.payment_id
    where id = p_receipt_upload_id;
  end if;

  update public.service_reports
  set completion_receipt_payload_signature = v_full_signature
  where id = v_base.service_report_id;

  return query select v_base.order_id, v_base.service_report_id,
    v_base.payment_id, v_base.completed_at;
end;
$$;

-- Bounded post-completion cleanup acknowledgements for reassignment orphans.
create or replace function public.technician_mark_reassigned_evidence_cleaned(
  p_actor_profile_id uuid, p_order_id uuid, p_upload_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orders o
    join public.technicians t on t.id = o.assigned_technician_id
    join public.profiles p on p.id = t.profile_id
    where o.id = p_order_id and p.id = p_actor_profile_id
      and p.role = 'TECHNICIAN' and p.active and t.active
  ) then raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001'; end if;
  update public.service_evidence_uploads
  set status = 'DELETED', failure_code = null
  where id = p_upload_id and order_id = p_order_id
    and status = 'ORPHANED' and failure_code = 'TECHNICIAN_REASSIGNED';
end;
$$;

create or replace function public.technician_mark_reassigned_receipt_cleaned(
  p_actor_profile_id uuid, p_order_id uuid, p_receipt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orders o
    join public.technicians t on t.id = o.assigned_technician_id
    join public.profiles p on p.id = t.profile_id
    where o.id = p_order_id and p.id = p_actor_profile_id
      and p.role = 'TECHNICIAN' and p.active and t.active
  ) then raise exception 'JOB_NOT_ASSIGNED' using errcode = 'P0001'; end if;
  update public.payment_receipt_uploads
  set status = 'DELETED', failure_code = null
  where id = p_receipt_id and order_id = p_order_id
    and status = 'ORPHANED' and failure_code = 'TECHNICIAN_REASSIGNED';
end;
$$;

revoke execute on function public.technician_complete_job(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid
) from service_role;

revoke all on function public.technician_reserve_payment_receipt(
  uuid, uuid, text, text, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.technician_confirm_payment_receipt(
  uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.technician_mark_payment_receipt(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.technician_complete_job_with_receipt(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.technician_mark_reassigned_evidence_cleaned(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.technician_mark_reassigned_receipt_cleaned(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.technician_reserve_payment_receipt(
  uuid, uuid, text, text, bigint, uuid
) to service_role;
grant execute on function public.technician_confirm_payment_receipt(
  uuid, uuid, uuid, uuid, text, bigint
) to service_role;
grant execute on function public.technician_mark_payment_receipt(
  uuid, uuid, uuid, text, text
) to service_role;
grant execute on function public.technician_complete_job_with_receipt(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid, uuid
) to service_role;
grant execute on function public.technician_mark_reassigned_evidence_cleaned(uuid, uuid, uuid)
to service_role;
grant execute on function public.technician_mark_reassigned_receipt_cleaned(uuid, uuid, uuid)
to service_role;
