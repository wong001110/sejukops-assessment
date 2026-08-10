create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('ADMIN', 'TECHNICIAN', 'MANAGER');
create type public.order_status as enum ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'JOB_DONE', 'REVIEWED', 'CLOSED');
create type public.reschedule_request_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
create type public.reschedule_source as enum ('DIRECT_ADMIN', 'DIRECT_MANAGER', 'TECHNICIAN_REQUEST');
create type public.notification_channel as enum ('WHATSAPP', 'IN_APP');
create type public.notification_status as enum ('READY', 'OPENED');
create type public.internal_notification_status as enum ('UNREAD', 'READ');
create type public.review_decision as enum ('APPROVED', 'CLARIFICATION_REQUESTED');
create type public.flag_status as enum ('OPEN', 'RESOLVED');
create type public.payment_method as enum ('CASH', 'CARD', 'BANK_TRANSFER', 'EWALLET', 'OTHER');
create type public.ai_routing_mode as enum ('SINGLE_MODEL', 'TASK_BASED');
create type public.ai_provider_status as enum ('ACTIVE', 'DISABLED', 'INVALID');
create type public.ai_task_type as enum (
  'OPERATIONS_QUERY',
  'WORKFLOW_EXPLANATION',
  'OPERATIONAL_INSIGHT',
  'DOCUMENT_UNDERSTANDING'
);

create table public.branches (
  id uuid primary key,
  code text not null unique check (code ~ '^BR-[0-9]{2}$'),
  name text not null check (btrim(name) <> ''),
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (btrim(display_name) <> ''),
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.technicians (
  id uuid primary key,
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key,
  name text not null check (btrim(name) <> ''),
  phone text not null check (phone ~ '^\+?[0-9][0-9 -]{6,20}$'),
  address text not null check (btrim(address) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key,
  order_no text not null unique check (order_no ~ '^ORD-[0-9]{4}-[0-9]{4,}$'),
  branch_id uuid not null references public.branches(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  assigned_technician_id uuid references public.technicians(id) on delete restrict,
  problem_description text not null check (btrim(problem_description) <> ''),
  service_type text not null check (btrim(service_type) <> ''),
  quoted_price numeric(12, 2) not null check (quoted_price >= 0),
  status public.order_status not null default 'NEW',
  admin_notes text,
  scheduled_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assigned_status_requires_technician check (
    status = 'NEW' or assigned_technician_id is not null
  )
);

create table public.order_reschedule_requests (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_schedule timestamptz,
  reason text not null check (btrim(reason) <> ''),
  status public.reschedule_request_status not null default 'PENDING',
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reschedule_request_resolution_consistent check (
    (status = 'PENDING' and resolved_by is null and resolved_at is null)
    or (status <> 'PENDING' and resolved_by is not null and resolved_at is not null)
  )
);

create table public.order_reschedules (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  previous_schedule timestamptz,
  new_schedule timestamptz not null,
  reason text,
  source public.reschedule_source not null,
  source_request_id uuid unique references public.order_reschedule_requests(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  same_day boolean generated always as (
    coalesce(
      (previous_schedule at time zone 'Asia/Kuala_Lumpur')::date =
      (new_schedule at time zone 'Asia/Kuala_Lumpur')::date,
      false
    )
  ) stored,
  created_at timestamptz not null default now(),
  constraint technician_request_requires_source_request check (
    (source = 'TECHNICIAN_REQUEST' and source_request_id is not null)
    or (source <> 'TECHNICIAN_REQUEST' and source_request_id is null)
  )
);

create table public.service_reports (
  id uuid primary key,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete restrict,
  work_done text not null check (btrim(work_done) <> ''),
  extra_charges numeric(12, 2) not null default 0 check (extra_charges >= 0),
  quoted_price_snapshot numeric(12, 2) not null check (quoted_price_snapshot >= 0),
  final_amount numeric(12, 2) generated always as (quoted_price_snapshot + extra_charges) stored,
  remarks text,
  started_at timestamptz,
  completed_at timestamptz,
  completion_request_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completion_after_start check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

create table public.service_attachments (
  id uuid primary key,
  service_report_id uuid not null references public.service_reports(id) on delete cascade,
  storage_bucket text not null default 'service-evidence' check (storage_bucket = 'service-evidence'),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 78643200),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  method public.payment_method not null,
  receipt_storage_path text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create table public.job_reviews (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  decision public.review_decision not null,
  note text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  channel public.notification_channel not null,
  business_key text not null,
  recipient text not null,
  message text not null,
  status public.notification_status not null default 'READY',
  generated_at timestamptz not null default now(),
  opened_at timestamptz,
  unique (order_id, channel, business_key),
  constraint opened_notification_is_consistent check (
    (status = 'READY' and opened_at is null)
    or (status = 'OPENED' and opened_at is not null)
  )
);

create table public.internal_notifications (
  id uuid primary key,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  business_key text not null,
  title text not null,
  message text not null,
  status public.internal_notification_status not null default 'UNREAD',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_profile_id, business_key),
  constraint read_notification_is_consistent check (
    (status = 'UNREAD' and read_at is null)
    or (status = 'READ' and read_at is not null)
  )
);

create table public.ai_flags (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  rule_code text not null,
  details jsonb not null default '{}'::jsonb,
  status public.flag_status not null default 'OPEN',
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, rule_code)
);

create table public.audit_logs (
  id uuid primary key,
  order_id uuid references public.orders(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  event_type text not null check (btrim(event_type) <> ''),
  idempotency_key text unique,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_provider_configs (
  id uuid primary key,
  name text not null,
  provider_type text not null,
  base_url text,
  model text not null,
  capabilities jsonb not null default '{}'::jsonb,
  encrypted_api_key text,
  key_last4 text check (key_last4 is null or length(key_last4) = 4),
  status public.ai_provider_status not null default 'DISABLED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_settings (
  id uuid primary key,
  routing_mode public.ai_routing_mode not null default 'SINGLE_MODEL',
  default_provider_config_id uuid references public.ai_provider_configs(id) on delete set null,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.ai_task_routes (
  id uuid primary key,
  task_type public.ai_task_type not null unique,
  provider_config_id uuid not null references public.ai_provider_configs(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index orders_status_idx on public.orders(status);
create index orders_branch_idx on public.orders(branch_id);
create index orders_assigned_technician_idx on public.orders(assigned_technician_id);
create index orders_scheduled_at_idx on public.orders(scheduled_at);
create index service_reports_completed_at_idx on public.service_reports(completed_at);
create index service_reports_technician_completed_idx on public.service_reports(technician_id, completed_at);
create index order_reschedules_created_at_idx on public.order_reschedules(created_at);
create index audit_logs_order_created_idx on public.audit_logs(order_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger branches_set_updated_at before update on public.branches
for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger technicians_set_updated_at before update on public.technicians
for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();
create trigger service_reports_set_updated_at before update on public.service_reports
for each row execute function public.set_updated_at();
create trigger ai_provider_configs_set_updated_at before update on public.ai_provider_configs
for each row execute function public.set_updated_at();

create or replace function public.enforce_service_evidence_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  maximum_file_bytes bigint;
  existing_file_count integer;
  existing_total_bytes bigint;
begin
  perform 1
  from public.service_reports
  where id = new.service_report_id
  for update;

  maximum_file_bytes := case
    when new.mime_type in ('image/jpeg', 'image/png', 'image/webp') then 12582912
    when new.mime_type in ('video/mp4', 'video/quicktime', 'video/webm') then 78643200
    when new.mime_type = 'application/pdf' then 15728640
    else 0
  end;

  if new.size_bytes > maximum_file_bytes then
    raise exception 'Evidence file exceeds the configured limit for MIME type %', new.mime_type
      using errcode = 'check_violation';
  end if;

  select count(*), coalesce(sum(size_bytes), 0)
  into existing_file_count, existing_total_bytes
  from public.service_attachments
  where service_report_id = new.service_report_id
    and id <> new.id;

  if existing_file_count >= 6 then
    raise exception 'A service report may contain at most 6 evidence files'
      using errcode = 'check_violation';
  end if;

  if existing_total_bytes + new.size_bytes > 125829120 then
    raise exception 'Service-report evidence exceeds the 120 MB combined limit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger service_attachments_enforce_limits
before insert or update of service_report_id, mime_type, size_bytes
on public.service_attachments
for each row execute function public.enforce_service_evidence_limits();

create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'NEW' and new.status = 'ASSIGNED')
    or (old.status = 'ASSIGNED' and new.status = 'IN_PROGRESS')
    or (old.status = 'IN_PROGRESS' and new.status = 'JOB_DONE')
    or (old.status = 'JOB_DONE' and new.status in ('REVIEWED', 'IN_PROGRESS'))
    or (old.status = 'REVIEWED' and new.status = 'CLOSED')
  ) then
    raise exception 'Invalid order lifecycle transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger orders_enforce_status_transition
before update of status on public.orders
for each row execute function public.enforce_order_status_transition();

create or replace function public.current_actor_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where auth_user_id = auth.uid() and active limit 1;
$$;

create or replace function public.current_actor_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.profiles where auth_user_id = auth.uid() and active limit 1;
$$;

create or replace function public.current_actor_technician_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.technicians t
  join public.profiles p on p.id = t.profile_id
  where p.auth_user_id = auth.uid() and p.active and t.active
  limit 1;
$$;

create or replace function public.can_access_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_actor_role() in ('ADMIN', 'MANAGER') then true
    when public.current_actor_role() = 'TECHNICIAN' then exists (
      select 1 from public.orders o
      where o.id = target_order_id
        and o.assigned_technician_id = public.current_actor_technician_id()
    )
    else false
  end;
$$;

revoke all on function public.current_actor_role() from public;
revoke all on function public.current_actor_profile_id() from public;
revoke all on function public.current_actor_technician_id() from public;
revoke all on function public.can_access_order(uuid) from public;
grant execute on function public.current_actor_role() to authenticated;
grant execute on function public.current_actor_profile_id() to authenticated;
grant execute on function public.current_actor_technician_id() to authenticated;
grant execute on function public.can_access_order(uuid) to authenticated;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.technicians enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_reschedule_requests enable row level security;
alter table public.order_reschedules enable row level security;
alter table public.service_reports enable row level security;
alter table public.service_attachments enable row level security;
alter table public.payments enable row level security;
alter table public.job_reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.internal_notifications enable row level security;
alter table public.ai_flags enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_provider_configs enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_task_routes enable row level security;

create policy branches_read_authenticated on public.branches
for select to authenticated using (true);
create policy profiles_read_authenticated on public.profiles
for select to authenticated using (true);
create policy technicians_read_authenticated on public.technicians
for select to authenticated using (true);

create policy orders_read_scoped on public.orders
for select to authenticated using (public.can_access_order(id));
create policy orders_create_admin on public.orders
for insert to authenticated with check (public.current_actor_role() = 'ADMIN');
create policy orders_update_admin on public.orders
for update to authenticated
using (public.current_actor_role() = 'ADMIN')
with check (public.current_actor_role() = 'ADMIN');

create policy customers_read_office on public.customers
for select to authenticated using (public.current_actor_role() in ('ADMIN', 'MANAGER'));
create policy customers_read_assigned_technician on public.customers
for select to authenticated using (
  public.current_actor_role() = 'TECHNICIAN'
  and exists (
    select 1 from public.orders o
    where o.customer_id = customers.id
      and o.assigned_technician_id = public.current_actor_technician_id()
  )
);
create policy customers_create_admin on public.customers
for insert to authenticated with check (public.current_actor_role() = 'ADMIN');
create policy customers_update_admin on public.customers
for update to authenticated using (public.current_actor_role() = 'ADMIN')
with check (public.current_actor_role() = 'ADMIN');

create policy service_reports_read_scoped on public.service_reports
for select to authenticated using (public.can_access_order(order_id));
create policy service_attachments_read_scoped on public.service_attachments
for select to authenticated using (
  exists (
    select 1 from public.service_reports sr
    where sr.id = service_report_id and public.can_access_order(sr.order_id)
  )
);
create policy order_reschedules_read_scoped on public.order_reschedules
for select to authenticated using (public.can_access_order(order_id));
create policy order_reschedule_requests_read_scoped on public.order_reschedule_requests
for select to authenticated using (public.can_access_order(order_id));
create policy payments_read_scoped on public.payments
for select to authenticated using (public.can_access_order(order_id));
create policy reviews_read_office on public.job_reviews
for select to authenticated using (public.current_actor_role() in ('ADMIN', 'MANAGER'));
create policy notifications_read_scoped on public.notifications
for select to authenticated using (public.can_access_order(order_id));
create policy internal_notifications_read_own on public.internal_notifications
for select to authenticated using (recipient_profile_id = public.current_actor_profile_id());
create policy flags_read_office on public.ai_flags
for select to authenticated using (public.current_actor_role() in ('ADMIN', 'MANAGER'));
create policy audit_read_scoped on public.audit_logs
for select to authenticated using (order_id is null or public.can_access_order(order_id));
create policy ai_provider_configs_admin_only on public.ai_provider_configs
for all to authenticated using (public.current_actor_role() = 'ADMIN')
with check (public.current_actor_role() = 'ADMIN');
create policy ai_settings_admin_only on public.ai_settings
for all to authenticated using (public.current_actor_role() = 'ADMIN')
with check (public.current_actor_role() = 'ADMIN');
create policy ai_task_routes_admin_only on public.ai_task_routes
for all to authenticated using (public.current_actor_role() = 'ADMIN')
with check (public.current_actor_role() = 'ADMIN');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-evidence',
  'service-evidence',
  false,
  78643200,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy service_evidence_read_scoped on storage.objects
for select to authenticated using (
  bucket_id = 'service-evidence'
  and public.can_access_order(((storage.foldername(name))[1])::uuid)
);
create policy service_evidence_insert_assigned on storage.objects
for insert to authenticated with check (
  bucket_id = 'service-evidence'
  and public.current_actor_role() = 'TECHNICIAN'
  and public.can_access_order(((storage.foldername(name))[1])::uuid)
);
create policy service_evidence_delete_assigned_or_office on storage.objects
for delete to authenticated using (
  bucket_id = 'service-evidence'
  and public.can_access_order(((storage.foldername(name))[1])::uuid)
);

comment on table public.order_reschedules is
  'Executed schedule changes; same-day changes remain countable events and never become lifecycle states.';
comment on column public.service_reports.completion_request_key is
  'Client request key used with the unique order report to make job completion retry-safe.';
comment on table public.notifications is
  'Observable notification actions only; assessment WhatsApp states are READY and OPENED.';
