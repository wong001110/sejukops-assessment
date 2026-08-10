-- Phase 8 Document Understanding: private source persistence, retry-safe
-- extraction drafts, and explicit atomic Admin confirmation into an order.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_source_status') then
    create type public.document_source_status as enum ('RESERVED', 'UPLOADED');
  end if;
  if not exists (select 1 from pg_type where typname = 'document_extraction_status') then
    create type public.document_extraction_status as enum (
      'NOT_STARTED', 'EXTRACTING', 'EXTRACTED', 'FAILED', 'CONFIRMED'
    );
  end if;
end
$$;

create table if not exists public.document_imports (
  id uuid primary key,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  upload_request_key uuid not null unique,
  upload_payload_signature text not null,
  storage_bucket text not null default 'documents' check (storage_bucket = 'documents'),
  storage_path text not null unique,
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in (
    'text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  source_status public.document_source_status not null default 'RESERVED',
  extraction_status public.document_extraction_status not null default 'NOT_STARTED',
  extraction_attempt_count integer not null default 0 check (extraction_attempt_count >= 0),
  extraction_request_key uuid unique,
  extraction_payload_signature text,
  provider_config_id uuid references public.ai_provider_configs(id) on delete set null,
  extracted_json jsonb,
  validation_issues jsonb,
  failure_code text,
  failure_retryable boolean,
  source_uploaded_at timestamptz,
  confirmation_request_key uuid unique,
  confirmation_payload_signature text,
  confirmation_customer_reused boolean,
  confirmed_order_id uuid unique references public.orders(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_import_source_timestamp check (
    source_status <> 'UPLOADED' or source_uploaded_at is not null
  ),
  constraint document_import_extraction_payload check (
    (extraction_status in ('EXTRACTED', 'CONFIRMED') and extracted_json is not null)
    or extraction_status not in ('EXTRACTED', 'CONFIRMED')
  ),
  constraint document_import_confirmation check (
    (extraction_status = 'CONFIRMED' and confirmed_order_id is not null
      and confirmed_at is not null and confirmation_customer_reused is not null)
    or (extraction_status <> 'CONFIRMED' and confirmed_order_id is null
      and confirmed_at is null and confirmation_customer_reused is null)
  )
);

create index if not exists document_imports_uploader_created_idx
on public.document_imports(uploaded_by, created_at desc);

drop trigger if exists document_imports_set_updated_at on public.document_imports;
create trigger document_imports_set_updated_at
before update on public.document_imports
for each row execute function public.set_updated_at();

alter table public.document_imports enable row level security;
revoke all on table public.document_imports from public, anon, authenticated;
grant select, insert, update on table public.document_imports to service_role;

create table if not exists public.document_import_extraction_requests (
  request_key uuid primary key,
  document_import_id uuid not null references public.document_imports(id) on delete cascade,
  payload_signature text not null,
  status text not null check (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
  provider_config_id uuid references public.ai_provider_configs(id) on delete set null,
  extracted_json jsonb,
  validation_issues jsonb,
  failure_code text,
  failure_retryable boolean,
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  constraint extraction_request_outcome check (
    (status = 'PENDING' and completed_at is null)
    or (status = 'SUCCEEDED' and extracted_json is not null and completed_at is not null)
    or (status = 'FAILED' and failure_code is not null and completed_at is not null)
  )
);

create index if not exists document_import_extraction_requests_import_idx
on public.document_import_extraction_requests(document_import_id, started_at desc);

alter table public.document_import_extraction_requests enable row level security;
revoke all on table public.document_import_extraction_requests from public, anon, authenticated;
grant select, insert, update on table public.document_import_extraction_requests to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 15728640,
  array['text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.admin_reserve_document_import(
  p_actor_profile_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_request_key uuid
)
returns table (
  document_import_id uuid,
  storage_path text,
  source_status public.document_source_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_path text;
  v_status public.document_source_status;
  v_existing_signature text;
  v_signature text := md5(jsonb_build_object(
    'actorProfileId', p_actor_profile_id,
    'originalFilename', btrim(p_original_filename),
    'mimeType', p_mime_type,
    'sizeBytes', p_size_bytes
  )::text);
  v_extension text;
  v_maximum bigint;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then
    raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('document:upload:' || p_request_key::text, 0)
  );
  select d.id, d.storage_path, d.source_status, d.upload_payload_signature
  into v_id, v_path, v_status, v_existing_signature
  from public.document_imports d
  where d.upload_request_key = p_request_key;
  if v_id is not null then
    if v_existing_signature is distinct from v_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_id, v_path, v_status;
    return;
  end if;

  v_maximum := case p_mime_type
    when 'text/plain' then 2097152
    when 'application/pdf' then 15728640
    when 'image/jpeg' then 12582912
    when 'image/png' then 12582912
    when 'image/webp' then 12582912
    else 0
  end;
  if v_maximum = 0 then
    raise exception 'DOCUMENT_MIME_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_size_bytes <= 0 or p_size_bytes > v_maximum then
    raise exception 'DOCUMENT_FILE_TOO_LARGE' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_original_filename), '') is null or length(p_original_filename) > 240 then
    raise exception 'INVALID_DOCUMENT_FILENAME' using errcode = 'P0001';
  end if;

  v_extension := case p_mime_type
    when 'text/plain' then 'txt'
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  v_id := gen_random_uuid();
  v_path := v_id::text || '/source.' || v_extension;
  insert into public.document_imports (
    id, uploaded_by, upload_request_key, upload_payload_signature,
    storage_path, original_filename, mime_type, size_bytes
  ) values (
    v_id, p_actor_profile_id, p_request_key, v_signature,
    v_path, btrim(p_original_filename), p_mime_type, p_size_bytes
  );
  return query select v_id, v_path, 'RESERVED'::public.document_source_status;
end;
$$;

create or replace function public.admin_confirm_document_source(
  p_actor_profile_id uuid,
  p_document_import_id uuid,
  p_request_key uuid,
  p_actual_mime_type text,
  p_actual_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.document_imports%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001'; end if;
  select * into v_import from public.document_imports d
  where d.id = p_document_import_id and d.uploaded_by = p_actor_profile_id for update;
  if not found then raise exception 'DOCUMENT_IMPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_import.upload_request_key <> p_request_key then
    raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
  end if;
  if v_import.source_status = 'UPLOADED' then return; end if;
  if v_import.mime_type <> p_actual_mime_type or v_import.size_bytes <> p_actual_size_bytes then
    raise exception 'STORAGE_METADATA_MISMATCH' using errcode = 'P0001';
  end if;
  update public.document_imports
  set source_status = 'UPLOADED', source_uploaded_at = clock_timestamp()
  where id = p_document_import_id;
end;
$$;

create or replace function public.admin_begin_document_extraction(
  p_actor_profile_id uuid,
  p_document_import_id uuid,
  p_request_key uuid
)
returns table (should_execute boolean, extraction_status public.document_extraction_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.document_imports%rowtype;
  v_request public.document_import_extraction_requests%rowtype;
  v_current public.document_import_extraction_requests%rowtype;
  v_signature text := md5(jsonb_build_object(
    'documentImportId', p_document_import_id,
    'action', 'EXTRACT'
  )::text);
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('document:extract:' || p_document_import_id::text, 0)
  );
  select * into v_import from public.document_imports d
  where d.id = p_document_import_id and d.uploaded_by = p_actor_profile_id for update;
  if not found then raise exception 'DOCUMENT_IMPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_request
  from public.document_import_extraction_requests r
  where r.request_key = p_request_key
  for update;
  if found then
    if v_request.document_import_id <> p_document_import_id
      or v_request.payload_signature is distinct from v_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_request.status = 'SUCCEEDED' then
      return query select false, 'EXTRACTED'::public.document_extraction_status;
      return;
    end if;
    if v_request.status = 'FAILED' then
      return query select false, 'FAILED'::public.document_extraction_status;
      return;
    end if;
    if v_request.lease_expires_at > clock_timestamp() then
      return query select false, 'EXTRACTING'::public.document_extraction_status;
      return;
    end if;
    update public.document_import_extraction_requests
    set started_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + interval '2 minutes'
    where request_key = p_request_key;
    update public.document_imports
    set extraction_status = 'EXTRACTING',
        extraction_request_key = p_request_key,
        extraction_payload_signature = v_signature,
        provider_config_id = null,
        extracted_json = null,
        validation_issues = null,
        failure_code = null,
        failure_retryable = null
    where id = p_document_import_id;
    return query select true, 'EXTRACTING'::public.document_extraction_status;
    return;
  end if;
  if v_import.source_status <> 'UPLOADED' then
    raise exception 'DOCUMENT_SOURCE_NOT_UPLOADED' using errcode = 'P0001';
  end if;
  if v_import.extraction_status = 'EXTRACTING' then
    select * into v_current
    from public.document_import_extraction_requests r
    where r.request_key = v_import.extraction_request_key
    for update;
    if found and v_current.status = 'PENDING'
      and v_current.lease_expires_at > clock_timestamp() then
      raise exception 'DOCUMENT_EXTRACTION_IN_PROGRESS' using errcode = 'P0001';
    end if;
    if found and v_current.status = 'PENDING' then
      update public.document_import_extraction_requests
      set status = 'FAILED', failure_code = 'AI_TIMEOUT', failure_retryable = true,
          completed_at = clock_timestamp()
      where request_key = v_current.request_key;
    end if;
  end if;
  if v_import.extraction_status = 'CONFIRMED' then
    raise exception 'DOCUMENT_ALREADY_CONFIRMED' using errcode = 'P0001';
  end if;
  insert into public.document_import_extraction_requests (
    request_key, document_import_id, payload_signature, status, lease_expires_at
  ) values (
    p_request_key, p_document_import_id, v_signature, 'PENDING',
    clock_timestamp() + interval '2 minutes'
  );
  update public.document_imports
  set extraction_status = 'EXTRACTING',
      extraction_attempt_count = extraction_attempt_count + 1,
      extraction_request_key = p_request_key,
      extraction_payload_signature = v_signature,
      provider_config_id = null,
      extracted_json = null,
      validation_issues = null,
      failure_code = null,
      failure_retryable = null
  where id = p_document_import_id;
  return query select true, 'EXTRACTING'::public.document_extraction_status;
end;
$$;

create or replace function public.admin_finish_document_extraction(
  p_actor_profile_id uuid,
  p_document_import_id uuid,
  p_request_key uuid,
  p_provider_config_id uuid,
  p_extracted_json jsonb,
  p_validation_issues jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001'; end if;
  update public.document_import_extraction_requests r
  set status = 'SUCCEEDED', provider_config_id = p_provider_config_id,
      extracted_json = p_extracted_json,
      validation_issues = coalesce(p_validation_issues, '{}'::jsonb),
      completed_at = clock_timestamp()
  where r.request_key = p_request_key
    and r.document_import_id = p_document_import_id
    and r.status = 'PENDING';
  if not found then raise exception 'DOCUMENT_EXTRACTION_SUPERSEDED' using errcode = 'P0001'; end if;

  update public.document_imports d
  set extraction_status = 'EXTRACTED',
      provider_config_id = p_provider_config_id,
      extracted_json = p_extracted_json,
      validation_issues = coalesce(p_validation_issues, '{}'::jsonb),
      failure_code = null,
      failure_retryable = null
  where d.id = p_document_import_id
    and d.uploaded_by = p_actor_profile_id
    and d.extraction_request_key = p_request_key
    and d.extraction_status = 'EXTRACTING';
  if not found then raise exception 'DOCUMENT_EXTRACTION_SUPERSEDED' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.admin_fail_document_extraction(
  p_actor_profile_id uuid,
  p_document_import_id uuid,
  p_request_key uuid,
  p_failure_code text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.document_import_extraction_requests r
  set status = 'FAILED',
      failure_code = left(coalesce(nullif(btrim(p_failure_code), ''), 'DOCUMENT_EXTRACTION_FAILED'), 80),
      failure_retryable = p_retryable,
      completed_at = clock_timestamp()
  where r.request_key = p_request_key
    and r.document_import_id = p_document_import_id
    and r.status = 'PENDING';
  if not found then raise exception 'DOCUMENT_EXTRACTION_SUPERSEDED' using errcode = 'P0001'; end if;

  update public.document_imports d
  set extraction_status = 'FAILED',
      failure_code = left(coalesce(nullif(btrim(p_failure_code), ''), 'DOCUMENT_EXTRACTION_FAILED'), 80),
      failure_retryable = p_retryable
  where d.id = p_document_import_id
    and d.uploaded_by = p_actor_profile_id
    and exists (
      select 1 from public.profiles p
      where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
    )
    and d.extraction_request_key = p_request_key
    and d.extraction_status = 'EXTRACTING';
  if not found then raise exception 'DOCUMENT_EXTRACTION_SUPERSEDED' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.admin_confirm_document_import_create(
  p_actor_profile_id uuid,
  p_document_import_id uuid,
  p_request_key uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_branch_id uuid,
  p_technician_id uuid,
  p_service_type text,
  p_service_details text,
  p_amount numeric,
  p_service_date date,
  p_admin_notes text
)
returns table (order_id uuid, customer_reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.document_imports%rowtype;
  v_order_id uuid;
  v_customer_reused boolean;
  v_signature text := md5(jsonb_build_object(
    'action', 'CREATE', 'customerName', btrim(p_customer_name),
    'customerPhone', regexp_replace(p_customer_phone, '[^0-9]', '', 'g'),
    'customerAddress', btrim(p_customer_address), 'branchId', p_branch_id,
    'technicianId', p_technician_id, 'serviceType', btrim(p_service_type),
    'serviceDetails', btrim(p_service_details), 'amount', p_amount,
    'serviceDate', p_service_date, 'adminNotes', nullif(btrim(p_admin_notes), '')
  )::text);
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  ) then raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('document:confirm:' || p_document_import_id::text, 0)
  );
  select * into v_import from public.document_imports d
  where d.id = p_document_import_id and d.uploaded_by = p_actor_profile_id for update;
  if not found then raise exception 'DOCUMENT_IMPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_import.extraction_status = 'CONFIRMED' then
    if v_import.confirmation_request_key is distinct from p_request_key
      or v_import.confirmation_payload_signature is distinct from v_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_import.confirmed_order_id, v_import.confirmation_customer_reused;
    return;
  end if;
  if v_import.extraction_status <> 'EXTRACTED' then
    raise exception 'DOCUMENT_NOT_READY_FOR_CONFIRMATION' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.document_imports d
    where d.confirmation_request_key = p_request_key and d.id <> p_document_import_id
  ) then raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001'; end if;

  select created.order_id, created.customer_reused
  into v_order_id, v_customer_reused
  from public.admin_create_order(
    p_actor_profile_id,
    p_request_key,
    null,
    p_customer_name,
    p_customer_phone,
    p_customer_address,
    p_branch_id,
    p_technician_id,
    ((p_service_date + time '09:00') at time zone 'Asia/Kuala_Lumpur'),
    p_service_details,
    p_service_type,
    p_amount,
    p_admin_notes
  ) created;

  update public.document_imports
  set extraction_status = 'CONFIRMED',
      confirmation_request_key = p_request_key,
      confirmation_payload_signature = v_signature,
      confirmation_customer_reused = v_customer_reused,
      confirmed_order_id = v_order_id,
      confirmed_at = clock_timestamp()
  where id = p_document_import_id;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json
  ) values (
    gen_random_uuid(), v_order_id, p_actor_profile_id, 'DOCUMENT_IMPORT_CONFIRMED',
    'document:confirm:' || p_document_import_id::text,
    jsonb_build_object('documentImportId', p_document_import_id, 'action', 'CREATE')
  );
  return query select v_order_id, v_customer_reused;
end;
$$;

revoke all on function public.admin_reserve_document_import(uuid, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.admin_confirm_document_source(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.admin_begin_document_extraction(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_finish_document_extraction(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.admin_fail_document_extraction(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_confirm_document_import_create(uuid, uuid, uuid, text, text, text, uuid, uuid, text, text, numeric, date, text) from public, anon, authenticated;

grant execute on function public.admin_reserve_document_import(uuid, text, text, bigint, uuid) to service_role;
grant execute on function public.admin_confirm_document_source(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.admin_begin_document_extraction(uuid, uuid, uuid) to service_role;
grant execute on function public.admin_finish_document_extraction(uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.admin_fail_document_extraction(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.admin_confirm_document_import_create(uuid, uuid, uuid, text, text, text, uuid, uuid, text, text, numeric, date, text) to service_role;

comment on table public.document_imports is
  'Private durable source and review draft; operational records are written only by explicit Admin confirmation.';
