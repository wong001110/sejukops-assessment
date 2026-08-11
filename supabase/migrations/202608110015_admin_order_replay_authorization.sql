-- Require a currently active Admin and bind exact create-order replay to the
-- actor that created the canonical audit outcome. Migration 014 is already
-- deployed and remains immutable; this replacement preserves its non-null
-- customer reuse correction while closing the stale-session replay boundary.

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
  v_existing_actor_profile_id uuid;
  v_existing_signature text;
  v_replay_found boolean;
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

  -- FOR SHARE is intentionally stronger than FOR KEY SHARE: deactivation
  -- updates a non-key column and must remain blocked through replay or create.
  perform 1
  from public.profiles p
  where p.id = p_actor_profile_id and p.role = 'ADMIN' and p.active
  for share;
  if not found then
    raise exception 'INVALID_ADMIN_ACTOR' using errcode = 'P0001';
  end if;

  select
    a.order_id,
    coalesce((a.metadata_json ->> 'customerReused')::boolean, false),
    a.actor_profile_id,
    a.metadata_json ->> 'payloadSignature'
  into
    v_order_id,
    v_customer_reused,
    v_existing_actor_profile_id,
    v_existing_signature
  from public.audit_logs a
  where a.idempotency_key = v_audit_key;

  v_replay_found := found;

  if v_replay_found then
    if v_order_id is null
      or v_existing_actor_profile_id is distinct from p_actor_profile_id
      or v_existing_signature is distinct from v_payload_signature then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_order_id, v_customer_reused;
    return;
  end if;

  -- SELECT INTO clears targets when the idempotency lookup has no row.
  v_customer_reused := false;

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

revoke all on function public.admin_create_order(
  uuid, uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, numeric, text
) from public, anon, authenticated;

grant execute on function public.admin_create_order(
  uuid, uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, numeric, text
) to service_role;
