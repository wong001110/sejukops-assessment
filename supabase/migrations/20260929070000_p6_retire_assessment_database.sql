-- P6 cutover: retire only the assessment-era global business schema.
-- Apply to the confirmed Sejuk Ops Test project after all old callers are gone.
-- Delete the objects in the private `documents` and `service-evidence` buckets
-- with the Storage API first. Direct SQL deletion of storage metadata can orphan
-- physical files; this migration never modifies storage.objects/buckets.

do $$
declare
  missing_tables text[];
begin
  if to_regclass('public.workspaces') is null
    or to_regclass('public.workspace_orders') is null
    or to_regclass('public.knowledge_documents') is null
    or to_regclass('public.ai_provider_configs') is null
    or to_regclass('public.ai_settings') is null
    or to_regclass('public.audit_logs') is null
  then
    raise exception 'REBUILD_SCHEMA_REQUIRED';
  end if;

  select array_agg(t.table_name order by t.table_name) into missing_tables
  from unnest(array[
    'branches', 'technicians', 'customers', 'orders',
    'order_reschedule_requests', 'order_reschedules', 'service_reports',
    'service_attachments', 'payments', 'job_reviews', 'notifications',
    'internal_notifications', 'ai_flags', 'service_evidence_uploads',
    'payment_receipt_uploads', 'workflow_supervisor_settings',
    'workflow_flag_explanation_requests', 'ai_operational_insight_cache',
    'document_imports', 'document_import_extraction_requests'
  ]) as t(table_name)
  where to_regclass('public.' || t.table_name) is null;
  if missing_tables is not null then
    raise exception 'LEGACY_SCHEMA_MISMATCH: %', missing_tables;
  end if;

  -- The owner authorized the exact reviewed Test-project inventory.
  -- Abort if the legacy or retained audit counts changed before execution.
  if (
      (select count(*) from public.branches) +
      (select count(*) from public.technicians) +
      (select count(*) from public.customers) +
      (select count(*) from public.orders) +
      (select count(*) from public.order_reschedule_requests) +
      (select count(*) from public.order_reschedules) +
      (select count(*) from public.service_reports) +
      (select count(*) from public.service_attachments) +
      (select count(*) from public.payments) +
      (select count(*) from public.job_reviews) +
      (select count(*) from public.notifications) +
      (select count(*) from public.internal_notifications) +
      (select count(*) from public.ai_flags) +
      (select count(*) from public.service_evidence_uploads) +
      (select count(*) from public.payment_receipt_uploads) +
      (select count(*) from public.workflow_supervisor_settings) +
      (select count(*) from public.workflow_flag_explanation_requests) +
      (select count(*) from public.ai_operational_insight_cache) +
      (select count(*) from public.document_imports) +
      (select count(*) from public.document_import_extraction_requests)
    ) <> 253
    or (select count(*) from public.audit_logs where order_id is not null) <> 69
    or (select count(*) from public.audit_logs where order_id is null) <> 62
  then
    raise exception 'LEGACY_INVENTORY_CHANGED_REVIEW_AGAIN';
  end if;

  if exists (
    select 1 from storage.objects
    where bucket_id in ('documents', 'service-evidence')
  ) then
    raise exception 'LEGACY_STORAGE_OBJECTS_REMAIN: empty only the two named buckets with the Storage API first';
  end if;
  if exists (
    select 1 from public.audit_logs
    where order_id is null and event_type not in (
      'AI_OBSERVATION', 'AI_PROVIDER_CONFIG_UPDATED', 'AI_ROUTING_UPDATED'
    )
  ) then
    raise exception 'UNCLASSIFIED_NULL_ORDER_AUDIT_REQUIRES_REVIEW';
  end if;
end;
$$;

-- Function names are fixed to the former assessment API. DROP has no CASCADE:
-- any unexpected dependency aborts the migration transaction.
-- First detach policies/triggers on the retired tables that depend on them.
do $$
declare
  old_policy record;
begin
  for old_policy in
    select pol.tablename, pol.policyname
    from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = any (array[
        'branches', 'technicians', 'customers', 'orders',
        'order_reschedule_requests', 'order_reschedules', 'service_reports',
        'service_attachments', 'payments', 'job_reviews', 'notifications',
        'internal_notifications', 'ai_flags', 'service_evidence_uploads',
        'payment_receipt_uploads', 'workflow_supervisor_settings',
        'workflow_flag_explanation_requests', 'ai_operational_insight_cache',
        'document_imports', 'document_import_extraction_requests'
      ])
  loop
    execute format('drop policy %I on public.%I',
      old_policy.policyname, old_policy.tablename);
  end loop;
end;
$$;

drop trigger if exists orders_enforce_status_transition on public.orders;
drop trigger if exists orders_generate_workflow_flags on public.orders;
drop trigger if exists service_attachments_enforce_limits on public.service_attachments;

drop function if exists public.ai_assert_runtime_actor(uuid);

do $$
declare
  old_function record;
begin
  for old_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'admin_begin_document_extraction',
        'admin_confirm_document_import_create',
        'admin_confirm_document_source',
        'admin_create_order',
        'admin_direct_reschedule_order',
        'admin_fail_document_extraction',
        'admin_finish_document_extraction',
        'admin_reserve_document_import',
        'admin_resolve_reschedule_request',
        'can_access_order',
        'current_actor_profile_id',
        'current_actor_role',
        'current_actor_technician_id',
        'enforce_order_status_transition',
        'enforce_service_evidence_limits',
        'manager_ai_get_jobs',
        'manager_ai_get_operational_summary',
        'manager_ai_get_technician_stats',
        'manager_ai_get_workload',
        'manager_ai_period_bounds',
        'manager_begin_workflow_flag_explanation',
        'manager_dashboard_metrics',
        'manager_direct_reschedule_order',
        'manager_get_workflow_flag',
        'manager_resolve_reschedule_request',
        'manager_review_job',
        'manager_store_workflow_flag_explanation',
        'open_completion_whatsapp',
        'prepare_completion_whatsapp',
        'technician_complete_job',
        'technician_complete_job_with_receipt',
        'technician_confirm_evidence_upload',
        'technician_confirm_payment_receipt',
        'technician_mark_evidence_upload',
        'technician_mark_payment_receipt',
        'technician_mark_reassigned_evidence_cleaned',
        'technician_mark_reassigned_receipt_cleaned',
        'technician_request_reschedule',
        'technician_reserve_evidence_upload',
        'technician_reserve_payment_receipt',
        'technician_start_job',
        'workflow_supervisor_flag_json',
        'workflow_supervisor_generate_flags',
        'workflow_supervisor_on_job_done'
      ])
    order by p.proname, p.oid
  loop
    execute format('drop function %s', old_function.signature);
  end loop;
end;
$$;

-- Retain platform configuration and technical observation history. Delete
-- only rows attached by FK to the retired global orders, then remove the FK.
delete from public.audit_logs where order_id is not null;
alter table public.audit_logs drop column order_id;

-- Explicit reverse FK order; no CASCADE and no workspace-scoped tables.
drop table public.document_import_extraction_requests;
drop table public.document_imports;
drop table public.workflow_flag_explanation_requests;
drop table public.workflow_supervisor_settings;
drop table public.ai_operational_insight_cache;
drop table public.service_evidence_uploads;
drop table public.payment_receipt_uploads;
drop table public.service_attachments;
drop table public.payments;
drop table public.job_reviews;
drop table public.notifications;
drop table public.internal_notifications;
drop table public.ai_flags;
drop table public.order_reschedules;
drop table public.order_reschedule_requests;
drop table public.service_reports;
drop table public.orders;
drop table public.technicians;
drop table public.customers;
drop table public.branches;

drop sequence if exists public.order_number_sequence;
drop type public.service_evidence_upload_status;
drop type public.order_status;
drop type public.reschedule_request_status;
drop type public.reschedule_source;
drop type public.notification_channel;
drop type public.notification_status;
drop type public.internal_notification_status;
drop type public.review_decision;
drop type public.flag_status;
drop type public.payment_method;
