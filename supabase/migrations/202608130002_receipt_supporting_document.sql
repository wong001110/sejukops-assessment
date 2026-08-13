-- Allow the optional receipt upload to act as a supporting document without
-- implying that a payment was received. Payment amount + method remain a
-- separate optional structured record.

alter table public.payment_receipt_uploads
  drop constraint if exists attached_receipt_has_payment;

alter table public.payment_receipt_uploads
  drop constraint if exists attached_receipt_payment_optional;

alter table public.payment_receipt_uploads
  add constraint attached_receipt_payment_optional check (
    status = 'ATTACHED' or payment_id is null
  );

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
  v_selected_receipt_id uuid := p_receipt_upload_id;
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

  -- The UI may omit receiptUploadId when no structured payment is recorded.
  -- There can only be one current receipt/supporting document for an order,
  -- so select the confirmed upload automatically in that case.
  if v_selected_receipt_id is null then
    select r.id into v_selected_receipt_id
    from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.order_id = p_order_id
      and r.technician_id = o.assigned_technician_id
      and r.status = 'UPLOADED'
    order by r.created_at desc
    limit 1;
  end if;

  if v_selected_receipt_id is not null then
    select r.* into v_receipt
    from public.payment_receipt_uploads r
    join public.orders o on o.id = r.order_id
    where r.id = v_selected_receipt_id
      and r.order_id = p_order_id
      and r.technician_id = o.assigned_technician_id
    for update of r;
    if not found then raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_receipt.status <> 'UPLOADED' then
      raise exception 'RECEIPT_NOT_UPLOADED' using errcode = 'P0001';
    end if;

    if v_base.payment_id is not null then
      update public.payments
      set receipt_storage_path = v_receipt.storage_path
      where id = v_base.payment_id;
    end if;

    update public.payment_receipt_uploads
    set status = 'ATTACHED', payment_id = v_base.payment_id
    where id = v_selected_receipt_id;
  end if;

  update public.service_reports
  set completion_receipt_payload_signature = v_full_signature
  where id = v_base.service_report_id;

  return query select v_base.order_id, v_base.service_report_id,
    v_base.payment_id, v_base.completed_at;
end;
$$;

comment on function public.technician_complete_job_with_receipt(
  uuid, uuid, text, numeric, text, numeric, public.payment_method, uuid, uuid
) is 'Completes a technician job and optionally attaches one receipt/supporting document independently of the optional structured payment record.';
