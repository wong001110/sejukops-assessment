do $seed$
declare
  reference_now timestamptz := coalesce(
    nullif(current_setting('sejukops.seed_reference_now', true), '')::timestamptz,
    '2026-08-14T12:00:00+08:00'::timestamptz
  );
  reference_day timestamptz;
  reference_week timestamptz;
begin
  reference_day := date_trunc('day', reference_now at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur';
  reference_week := date_trunc('week', reference_now at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur';

  -- Reset only the reserved deterministic fixture namespace. This makes a
  -- rerun restore golden facts even if a prior demo mutated lifecycle state.
  delete from public.order_reschedules
  where order_id::text like '00000000-0000-4000-8000-0000000040%';
  delete from public.order_reschedule_requests
  where order_id::text like '00000000-0000-4000-8000-0000000040%';
  delete from public.orders
  where id::text like '00000000-0000-4000-8000-0000000040%';

  insert into public.branches (id, code, name, address, active)
  values
    ('00000000-0000-4000-8000-000000000101', 'BR-01', 'Branch 01', '1 Jalan Demo, Kuala Lumpur', true),
    ('00000000-0000-4000-8000-000000000102', 'BR-02', 'Branch 02', '2 Jalan Demo, Petaling Jaya', true),
    ('00000000-0000-4000-8000-000000000103', 'BR-03', 'Branch 03', '3 Jalan Demo, Shah Alam', true),
    ('00000000-0000-4000-8000-000000000104', 'BR-04', 'Branch 04', '4 Jalan Demo, Subang Jaya', true),
    ('00000000-0000-4000-8000-000000000105', 'BR-05', 'Branch 05', '5 Jalan Demo, Putrajaya', true)
  on conflict (id) do update set
    code = excluded.code, name = excluded.name, address = excluded.address, active = excluded.active;

  insert into public.profiles (id, display_name, role, active)
  values
    ('00000000-0000-4000-8000-000000001001', 'Admin Demo', 'ADMIN', true),
    ('00000000-0000-4000-8000-000000001002', 'Manager Demo', 'MANAGER', true),
    ('00000000-0000-4000-8000-000000001003', 'Ali', 'TECHNICIAN', true),
    ('00000000-0000-4000-8000-000000001004', 'John', 'TECHNICIAN', true),
    ('00000000-0000-4000-8000-000000001005', 'Bala', 'TECHNICIAN', true),
    ('00000000-0000-4000-8000-000000001006', 'Yusoff', 'TECHNICIAN', true)
  on conflict (id) do update set
    display_name = excluded.display_name, role = excluded.role, active = excluded.active;

  insert into public.technicians (id, profile_id, branch_id, active)
  values
    ('00000000-0000-4000-8000-000000002003', '00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000101', true),
    ('00000000-0000-4000-8000-000000002004', '00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000102', true),
    ('00000000-0000-4000-8000-000000002005', '00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000103', true),
    ('00000000-0000-4000-8000-000000002006', '00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000104', true)
  on conflict (id) do update set
    profile_id = excluded.profile_id, branch_id = excluded.branch_id, active = excluded.active;

  insert into public.customers (id, name, phone, address)
  values
    ('00000000-0000-4000-8000-000000003001', 'Ahmad', '+600000000001', '11 Jalan Fiksyen, Kuala Lumpur'),
    ('00000000-0000-4000-8000-000000003002', 'Siti Demo', '+600000000002', '12 Jalan Fiksyen, Petaling Jaya'),
    ('00000000-0000-4000-8000-000000003003', 'Kumar Test', '+600000000003', '13 Jalan Fiksyen, Shah Alam'),
    ('00000000-0000-4000-8000-000000003004', 'Mei Ling Sample', '+600000000004', '14 Jalan Fiksyen, Subang Jaya'),
    ('00000000-0000-4000-8000-000000003005', 'Farah Example', '+600000000005', '15 Jalan Fiksyen, Putrajaya'),
    ('00000000-0000-4000-8000-000000003006', 'Ravi Fixture', '+600000000006', '16 Jalan Fiksyen, Klang'),
    ('00000000-0000-4000-8000-000000003007', 'Nurul Mock', '+600000000007', '17 Jalan Fiksyen, Kajang'),
    ('00000000-0000-4000-8000-000000003008', 'Daniel Sandbox', '+600000000008', '18 Jalan Fiksyen, Cyberjaya')
  on conflict (id) do update set name = excluded.name, phone = excluded.phone, address = excluded.address;

  insert into public.orders (
    id, order_no, branch_id, customer_id, assigned_technician_id,
    problem_description, service_type, quoted_price, status, admin_notes,
    scheduled_at, created_by, created_at
  )
  select
    seeded.id::uuid,
    seeded.order_no,
    seeded.branch_id::uuid,
    seeded.customer_id::uuid,
    case
      when seeded.order_no = 'ORD-2026-0037' then '00000000-0000-4000-8000-000000002004'::uuid
      when seeded.branch_id = '00000000-0000-4000-8000-000000000101' then '00000000-0000-4000-8000-000000002003'::uuid
      when seeded.branch_id = '00000000-0000-4000-8000-000000000102' then '00000000-0000-4000-8000-000000002004'::uuid
      when seeded.branch_id = '00000000-0000-4000-8000-000000000103' then '00000000-0000-4000-8000-000000002005'::uuid
      when seeded.branch_id = '00000000-0000-4000-8000-000000000104' then '00000000-0000-4000-8000-000000002006'::uuid
      else null
    end,
    seeded.problem_description,
    seeded.service_type,
    seeded.quoted_price,
    seeded.status::public.order_status,
    seeded.admin_notes,
    seeded.scheduled_at,
    seeded.created_by::uuid,
    seeded.created_at
  from (values
    ('00000000-0000-4000-8000-000000004001','ORD-2026-0001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003001','Routine cooling maintenance','Aircond Cleaning',180,'CLOSED','Seed fixture',reference_week - interval '35 days' + interval '8 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '35 days' + interval '5 hours'),
    ('00000000-0000-4000-8000-000000004002','ORD-2026-0002','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003002','Indoor unit is leaking','Repair',240,'CLOSED','Seed fixture',reference_week - interval '32 days' + interval '10 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '32 days' + interval '7 hours'),
    ('00000000-0000-4000-8000-000000004003','ORD-2026-0003','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003003','Cooling performance is low','Gas Refill',160,'REVIEWED','Seed fixture',reference_week - interval '29 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '29 days' + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004004','ORD-2026-0004','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003004','Install bedroom unit','Installation',650,'CLOSED','Seed fixture',reference_week - interval '26 days' + interval '11 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '26 days' + interval '8 hours'),
    ('00000000-0000-4000-8000-000000004005','ORD-2026-0005','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003005','Annual system inspection','Inspection',120,'CLOSED','Seed fixture',reference_week - interval '23 days' + interval '14 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '23 days' + interval '11 hours'),
    ('00000000-0000-4000-8000-000000004006','ORD-2026-0006','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003006','Outdoor unit is noisy','Repair',280,'CLOSED','Seed fixture',reference_week - interval '20 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '20 days' + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004007','ORD-2026-0007','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003007','Routine filter cleaning','Aircond Cleaning',170,'REVIEWED','Seed fixture',reference_week - interval '18 days' + interval '13 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '18 days' + interval '10 hours'),
    ('00000000-0000-4000-8000-000000004008','ORD-2026-0008','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003008','Replace damaged drain hose','Repair',230,'CLOSED','Seed fixture',reference_week - interval '16 days' + interval '15 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '16 days' + interval '12 hours'),
    ('00000000-0000-4000-8000-000000004009','ORD-2026-0009','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003001','Top up refrigerant','Gas Refill',190,'CLOSED','Seed fixture',reference_week - interval '14 days' + interval '8 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '14 days' + interval '5 hours'),
    ('00000000-0000-4000-8000-000000004010','ORD-2026-0010','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003002','Inspect intermittent shutdown','Inspection',140,'JOB_DONE','Seed fixture',reference_week - interval '12 days' + interval '10 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '12 days' + interval '7 hours'),
    ('00000000-0000-4000-8000-000000004011','ORD-2026-0011','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003003','Clean office cassette','Aircond Cleaning',220,'CLOSED','Last-week control',reference_week - interval '7 days' + interval '8 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '7 days' + interval '5 hours'),
    ('00000000-0000-4000-8000-000000004012','ORD-2026-0012','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003004','Living room unit not cold','Repair',260,'CLOSED','Golden Ali last-week fixture',reference_week - interval '6 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '6 days' + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004013','ORD-2026-0013','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003005','Gas pressure below range','Gas Refill',180,'REVIEWED','Last-week control',reference_week - interval '6 days' + interval '14 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '6 days' + interval '11 hours'),
    ('00000000-0000-4000-8000-000000004014','ORD-2026-0014','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003006','Install meeting room unit','Installation',720,'CLOSED','Last-week control',reference_week - interval '5 days' + interval '10 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '5 days' + interval '7 hours'),
    ('00000000-0000-4000-8000-000000004015','ORD-2026-0015','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003007','Check unusual compressor sound','Inspection',150,'CLOSED','Last-week control',reference_week - interval '4 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '4 days' + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004016','ORD-2026-0016','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003008','Replace fan capacitor','Repair',290,'JOB_DONE','Last-week control',reference_week - interval '4 days' + interval '15 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '4 days' + interval '12 hours'),
    ('00000000-0000-4000-8000-000000004017','ORD-2026-0017','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003001','Deep clean two wall units','Aircond Cleaning',300,'CLOSED','Golden Ali last-week fixture',reference_week - interval '3 days' + interval '12 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '3 days' + interval '9 hours'),
    ('00000000-0000-4000-8000-000000004018','ORD-2026-0018','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003002','Top up refrigerant','Gas Refill',175,'REVIEWED','Last-week control',reference_week - interval '2 days' + interval '11 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '2 days' + interval '8 hours'),
    ('00000000-0000-4000-8000-000000004019','ORD-2026-0019','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003003','Clean showroom units','Aircond Cleaning',340,'CLOSED','Last-week control',reference_week - interval '1 day' + interval '10 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '1 day' + interval '7 hours'),
    ('00000000-0000-4000-8000-000000004020','ORD-2026-0020','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003004','Repair leaking drain tray','Repair',270,'CLOSED','Golden Ali last-week fixture',reference_week - interval '1 day' + interval '15 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '1 day' + interval '12 hours'),
    ('00000000-0000-4000-8000-000000004021','ORD-2026-0021','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003005','Clean bedroom unit','Aircond Cleaning',180,'CLOSED','Current-week fixture',reference_week + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004022','ORD-2026-0022','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003006','Repair control board','Repair',250,'CLOSED','Current-week fixture',reference_week + interval '15 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '12 hours'),
    ('00000000-0000-4000-8000-000000004023','ORD-2026-0023','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003007','Top up refrigerant','Gas Refill',160,'REVIEWED','Current-week fixture',reference_week + interval '1 day 10 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '1 day 7 hours'),
    ('00000000-0000-4000-8000-000000004024','ORD-2026-0024','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003008','Inspect vibration','Inspection',220,'CLOSED','Current-week fixture',reference_week + interval '1 day 16 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '1 day 13 hours'),
    ('00000000-0000-4000-8000-000000004025','ORD-2026-0025','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003001','Install small office unit','Installation',300,'CLOSED','Current-week fixture',reference_week + interval '2 days 9 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '2 days 6 hours'),
    ('00000000-0000-4000-8000-000000004026','ORD-2026-0026','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003002','Routine service','Aircond Cleaning',190,'CLOSED','Current-week fixture',reference_week + interval '2 days 14 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '2 days 11 hours'),
    ('00000000-0000-4000-8000-000000004027','ORD-2026-0027','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003003','Replace fan motor','Repair',280,'CLOSED','Current-week fixture',reference_week + interval '3 days 9 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '3 days 6 hours'),
    ('00000000-0000-4000-8000-000000004028','ORD-2026-0028','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003004','Check gas pressure','Gas Refill',150,'CLOSED','Current-week fixture',reference_week + interval '3 days 13 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '3 days 10 hours'),
    ('00000000-0000-4000-8000-000000004029','ORD-2026-0029','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003005','Inspect electrical load','Inspection',210,'REVIEWED','Current-week fixture',reference_week + interval '3 days 17 hours','00000000-0000-4000-8000-000000001001',reference_week + interval '3 days 14 hours'),
    ('00000000-0000-4000-8000-000000004030','ORD-2026-0030','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003006','Repair severe drainage fault','Repair',170,'JOB_DONE','High-variance workflow fixture',reference_day + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_day + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004031','ORD-2026-0031','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003007','Install replacement unit','Installation',260,'CLOSED','Normal workflow control',reference_day + interval '10 hours','00000000-0000-4000-8000-000000001001',reference_day + interval '7 hours'),
    ('00000000-0000-4000-8000-000000004032','ORD-2026-0032','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003008','Routine inspection','Inspection',140,'CLOSED','Today fixture',reference_day + interval '11 hours','00000000-0000-4000-8000-000000001001',reference_day + interval '8 hours'),
    ('00000000-0000-4000-8000-000000004033','ORD-2026-0033','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003001','Service noisy wall unit','Aircond Cleaning',230,'JOB_DONE','Missing-evidence workflow fixture',reference_day + interval '12 hours','00000000-0000-4000-8000-000000001001',reference_day + interval '9 hours'),
    ('00000000-0000-4000-8000-000000004034','ORD-2026-0034','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003002','Repair compressor relay','Repair',320,'CLOSED','Today fixture',reference_day + interval '13 hours','00000000-0000-4000-8000-000000001001',reference_day + interval '10 hours'),
    ('00000000-0000-4000-8000-000000004035','ORD-2026-0035','00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000003003','Awaiting triage','Inspection',100,'NEW','BR-05 zero-completion fixture',reference_day + interval '2 days 9 hours','00000000-0000-4000-8000-000000001001',reference_now),
    ('00000000-0000-4000-8000-000000004036','ORD-2026-0036','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000003004','Scheduled cleaning','Aircond Cleaning',180,'ASSIGNED','Known status and Ali workload fixture',reference_day + interval '1 day 9 hours','00000000-0000-4000-8000-000000001001',reference_now),
    ('00000000-0000-4000-8000-000000004037','ORD-2026-0037','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003005','Diagnosing electrical issue','Repair',240,'IN_PROGRESS','Cross-branch assignment proves assignment scope',reference_day + interval '4 hours','00000000-0000-4000-8000-000000001001',reference_now - interval '2 hours'),
    ('00000000-0000-4000-8000-000000004038','ORD-2026-0038','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000003006','Completed refill','Gas Refill',155,'JOB_DONE','Lifecycle fixture',reference_week - interval '9 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '9 days' + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004039','ORD-2026-0039','00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000003007','Reviewed installation','Installation',580,'REVIEWED','Lifecycle fixture',reference_week - interval '10 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '10 days' + interval '6 hours'),
    ('00000000-0000-4000-8000-000000004040','ORD-2026-0040','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000003008','Closed inspection','Inspection',130,'CLOSED','Lifecycle fixture',reference_week - interval '11 days' + interval '9 hours','00000000-0000-4000-8000-000000001001',reference_week - interval '11 days' + interval '6 hours')
  ) as seeded(
    id, order_no, branch_id, customer_id, problem_description, service_type,
    quoted_price, status, admin_notes, scheduled_at, created_by, created_at
  )
  on conflict (id) do update set
    order_no = excluded.order_no,
    branch_id = excluded.branch_id,
    customer_id = excluded.customer_id,
    assigned_technician_id = excluded.assigned_technician_id,
    problem_description = excluded.problem_description,
    service_type = excluded.service_type,
    quoted_price = excluded.quoted_price,
    status = excluded.status,
    admin_notes = excluded.admin_notes,
    scheduled_at = excluded.scheduled_at,
    created_by = excluded.created_by,
    created_at = excluded.created_at;

  insert into public.service_reports (
    id, order_id, technician_id, work_done, extra_charges, quoted_price_snapshot,
    remarks, started_at, completed_at, completion_request_key, created_at
  )
  select
    md5('service-report:' || o.id::text)::uuid,
    o.id,
    o.assigned_technician_id,
    'Completed deterministic assessment service work',
    case o.order_no
      when 'ORD-2026-0021' then 20 when 'ORD-2026-0023' then 20
      when 'ORD-2026-0024' then 30 when 'ORD-2026-0026' then 10
      when 'ORD-2026-0027' then 40 when 'ORD-2026-0029' then 20
      when 'ORD-2026-0030' then 200 when 'ORD-2026-0031' then 15
      when 'ORD-2026-0032' then 10 when 'ORD-2026-0034' then 30
      else 0
    end,
    o.quoted_price,
    'Fictional assessment fixture',
    o.created_at + interval '1 hour',
    o.created_at + interval '3 hours',
    'seed-complete:' || o.order_no,
    o.created_at + interval '1 hour'
  from public.orders o
  where o.id::text like '00000000-0000-4000-8000-0000000040%'
    and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')
  on conflict (order_id) do update set
    technician_id = excluded.technician_id,
    work_done = excluded.work_done,
    extra_charges = excluded.extra_charges,
    quoted_price_snapshot = excluded.quoted_price_snapshot,
    remarks = excluded.remarks,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    completion_request_key = excluded.completion_request_key,
    created_at = excluded.created_at;

  insert into public.service_attachments (
    id, service_report_id, storage_path, original_filename, mime_type, size_bytes, created_at
  )
  select
    md5('service-attachment:' || sr.order_id::text)::uuid,
    sr.id,
    sr.order_id::text || '/' || md5('service-attachment:' || sr.order_id::text)::text || '-valid-photo.jpg',
    'valid-photo.jpg',
    'image/jpeg',
    1024,
    sr.completed_at
  from public.service_reports sr
  where sr.order_id::text like '00000000-0000-4000-8000-0000000040%'
    and sr.order_id <> '00000000-0000-4000-8000-000000004033'
  on conflict (id) do update set
    service_report_id = excluded.service_report_id,
    storage_path = excluded.storage_path,
    original_filename = excluded.original_filename,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    created_at = excluded.created_at;

  insert into public.order_reschedule_requests (
    id, order_id, requested_by, requested_schedule, reason, status,
    resolved_by, resolution_note, created_at, resolved_at
  )
  values
    ('00000000-0000-4000-8000-000000007001','00000000-0000-4000-8000-000000004023','00000000-0000-4000-8000-000000001005',reference_week + interval '1 day 10 hours','Customer requested a later appointment','APPROVED','00000000-0000-4000-8000-000000001002','Approved fixture',reference_week + interval '2 hours',reference_week + interval '3 hours'),
    ('00000000-0000-4000-8000-000000007002','00000000-0000-4000-8000-000000004025','00000000-0000-4000-8000-000000001004',reference_week + interval '3 days 9 hours','Requested time conflicts with field route','REJECTED','00000000-0000-4000-8000-000000001001','Existing slot retained',reference_week + interval '1 day 2 hours',reference_week + interval '1 day 3 hours')
  on conflict (id) do update set
    order_id = excluded.order_id, requested_by = excluded.requested_by,
    requested_schedule = excluded.requested_schedule, reason = excluded.reason,
    status = excluded.status, resolved_by = excluded.resolved_by,
    resolution_note = excluded.resolution_note, created_at = excluded.created_at,
    resolved_at = excluded.resolved_at;

  insert into public.order_reschedules (
    id, order_id, previous_schedule, new_schedule, reason, source,
    source_request_id, created_by, created_at
  )
  values
    ('00000000-0000-4000-8000-000000007101','00000000-0000-4000-8000-000000004021',reference_week + interval '8 hours',reference_week + interval '9 hours','Admin route adjustment','DIRECT_ADMIN',null,'00000000-0000-4000-8000-000000001001',reference_week + interval '1 hour'),
    ('00000000-0000-4000-8000-000000007102','00000000-0000-4000-8000-000000004022',reference_week + interval '1 day 15 hours',reference_week + interval '15 hours','Manager balanced the schedule','DIRECT_MANAGER',null,'00000000-0000-4000-8000-000000001002',reference_week + interval '2 hours'),
    ('00000000-0000-4000-8000-000000007103','00000000-0000-4000-8000-000000004023',reference_week + interval '8 hours',reference_week + interval '1 day 10 hours','Approved Technician request','TECHNICIAN_REQUEST','00000000-0000-4000-8000-000000007001','00000000-0000-4000-8000-000000001002',reference_week + interval '3 hours'),
    ('00000000-0000-4000-8000-000000007104','00000000-0000-4000-8000-000000004024',reference_week + interval '1 day 9 hours',reference_week + interval '1 day 16 hours','Same-day time adjustment','DIRECT_ADMIN',null,'00000000-0000-4000-8000-000000001001',reference_week + interval '1 day 4 hours')
  on conflict (id) do update set
    order_id = excluded.order_id, previous_schedule = excluded.previous_schedule,
    new_schedule = excluded.new_schedule, reason = excluded.reason,
    source = excluded.source, source_request_id = excluded.source_request_id,
    created_by = excluded.created_by, created_at = excluded.created_at;

  insert into public.ai_flags (
    id, order_id, completion_revision, rule_code, severity, title,
    deterministic_summary, details, status, created_at
  )
  values
    (
      '00000000-0000-4000-8000-000000007201','00000000-0000-4000-8000-000000004030',1,
      'HIGH_AMOUNT_VARIANCE','CRITICAL','Final amount is significantly above quote',
      'The final amount exceeded the configured quoted-price variance threshold.',
      jsonb_build_object(
        'serviceReportId', md5('service-report:00000000-0000-4000-8000-000000004030')::uuid,
        'quotedPrice',170,'extraCharges',200,'finalAmount',370,
        'varianceAmount',200,'varianceRatio',200::numeric / 170,
        'configuredMinimum',100,'configuredRatio',0.50
      ),'OPEN',reference_day + interval '9 hours'
    ),
    (
      '00000000-0000-4000-8000-000000007202','00000000-0000-4000-8000-000000004033',1,
      'MISSING_EVIDENCE','WARNING','Completed job has no service evidence',
      'The job reached JOB_DONE without an attached service evidence file.',
      jsonb_build_object(
        'serviceReportId', md5('service-report:00000000-0000-4000-8000-000000004033')::uuid,
        'attachmentCount',0
      ),'OPEN',reference_day + interval '12 hours'
    ),
    (
      '00000000-0000-4000-8000-000000007203','00000000-0000-4000-8000-000000004030',1,
      'UNUSUAL_EXTRA_CHARGE','WARNING','Extra charges require review',
      'The extra charge exceeded the configured amount or quoted-price ratio threshold.',
      jsonb_build_object(
        'serviceReportId', md5('service-report:00000000-0000-4000-8000-000000004030')::uuid,
        'quotedPrice',170,'extraCharges',200,'finalAmount',370,
        'extraChargeRatio',200::numeric / 170,
        'configuredMinimum',250,'configuredRatio',1.00
      ),'OPEN',reference_day + interval '9 hours'
    )
  on conflict (order_id, completion_revision, rule_code) do update set
    severity = excluded.severity, title = excluded.title,
    deterministic_summary = excluded.deterministic_summary,
    details = excluded.details, status = excluded.status,
    created_at = excluded.created_at;

  delete from public.notifications n
  where n.business_key = 'CUSTOMER_JOB_COMPLETED'
    and n.order_id::text like '00000000-0000-4000-8000-0000000040%';

  insert into public.notifications (
    id, order_id, channel, business_key, recipient, message, status, generated_at
  )
  select
    md5('whatsapp-notification:' || o.id::text)::uuid,
    o.id,
    'WHATSAPP',
    'completion:' || sr.id::text || ':revision:'
      || coalesce(sr.completion_revision, 1)::text,
    case
      when left(regexp_replace(c.phone, '[^0-9]', '', 'g'), 1) = '0'
      then '60' || substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 2)
      else regexp_replace(c.phone, '[^0-9]', '', 'g')
    end,
    'Hi ' || c.name || E',\n\n'
      || 'Job ' || o.order_no || ' has been completed by Technician '
      || tp.display_name || ' at '
      || to_char(sr.completed_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY, HH12:MI AM')
      || E'.\nPlease check the service and leave feedback.\n\nThank you!',
    'READY',
    sr.completed_at
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.service_reports sr on sr.order_id = o.id
  join public.technicians t on t.id = sr.technician_id
  join public.profiles tp on tp.id = t.profile_id
  where o.id::text like '00000000-0000-4000-8000-0000000040%'
  on conflict (order_id, channel, business_key) do update set
    recipient = excluded.recipient,
    message = excluded.message,
    status = excluded.status,
    generated_at = excluded.generated_at,
    opened_at = null;

  insert into public.audit_logs (
    id, order_id, actor_profile_id, event_type, idempotency_key, metadata_json, created_at
  )
  select
    md5('completion-audit:' || o.id::text)::uuid,
    o.id,
    t.profile_id,
    'JOB_COMPLETED',
    'seed-job-completed:' || o.order_no,
    jsonb_build_object('fixture', true, 'orderNo', o.order_no),
    sr.completed_at
  from public.orders o
  join public.technicians t on t.id = o.assigned_technician_id
  join public.service_reports sr on sr.order_id = o.id
  where o.id::text like '00000000-0000-4000-8000-0000000040%'
  on conflict (id) do update set
    actor_profile_id = excluded.actor_profile_id,
    event_type = excluded.event_type,
    idempotency_key = excluded.idempotency_key,
    metadata_json = excluded.metadata_json,
    created_at = excluded.created_at;
end
$seed$;
