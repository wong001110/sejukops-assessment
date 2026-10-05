-- Fixed, wholly fictional Demo knowledge. This privileged fixture publication
-- is selected in source control; it is not evidence of an interactive human
-- publication review or model answer quality. No Owner row is read or written.

create function private.demo_seed_knowledge()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_generation bigint;
  v_workspace_count integer;
  v_admin_count integer;
  v_admin_profile_id uuid;
  v_document_id uuid;
  v_version_id uuid;
  v_item record;
begin
  select count(*)::integer into v_workspace_count
  from public.workspaces w where w.kind = 'DEMO' and w.active;
  if v_workspace_count <> 1 then
    raise exception 'DEMO_UNAVAILABLE_OR_AMBIGUOUS' using errcode = 'P0001';
  end if;
  -- Serialize with Demo reset and generation-aware knowledge writes.
  select w.id, w.generation into v_workspace_id, v_generation
  from public.workspaces w where w.kind = 'DEMO' and w.active for update;
  if v_workspace_id is null or v_generation is null or v_generation < 1 then
    raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select count(*)::integer, (array_agg(p.id))[1]
  into v_admin_count, v_admin_profile_id
  from public.profiles p
  join auth.users u on u.id = p.auth_user_id
  join public.workspace_memberships m on m.profile_id = p.id
  where m.workspace_id = v_workspace_id and m.active and m.role = 'ADMIN'
    and p.active and p.demo_principal and p.platform_role = 'USER'
    and p.role = 'ADMIN' and not u.is_anonymous;
  -- Initial migrations may run before fixed Demo principals are bootstrapped.
  if v_admin_count = 0 then return false; end if;
  if v_admin_count <> 1 then
    raise exception 'DEMO_PRINCIPAL_AMBIGUOUS' using errcode = 'P0001';
  end if;

  -- Preserve any existing shared Demo knowledge, including a manually
  -- archived/replaced fixture. Reset removes it and starts a fresh generation.
  if exists (select 1 from public.knowledge_documents d
      where d.workspace_id = v_workspace_id) then return false; end if;

  for v_item in
    select fixture.title, fixture.source_text from (values
      ('Fictional QX-731 filter guide',
       'Fictional QX-731 demonstration filter. Replace the QX-731 cartridge every six months during a Demo maintenance visit. Record observed airflow before closing the work order. 虚构示范机型 QX-731：每六个月更换一次滤芯，完成工单前记录风量。'),
      ('Fictional Demo leak triage',
       'For a fictional demonstration water leak, record where the water appears and assign a qualified Demo technician. Do not mark the case complete until the inspection notes are reviewed. 虚构示范漏水案例：记录漏水位置并交由示范技术员检查。')
    ) as fixture(title, source_text)
  loop
    insert into public.knowledge_documents
      (workspace_id, generation, title, source_label, created_by_profile_id)
    values (v_workspace_id, v_generation, v_item.title,
      'Sejuk Ops fictional Demo reference v1', v_admin_profile_id)
    returning id into v_document_id;

    insert into public.knowledge_versions
      (workspace_id, document_id, version_no, generation, source_text, sha256,
       source_kind, index_state, chunk_count, created_by_profile_id)
    values (v_workspace_id, v_document_id, 1, v_generation, v_item.source_text,
      encode(extensions.digest(convert_to(v_item.source_text, 'UTF8'), 'sha256'), 'hex'),
      'TEXT', 'READY', 1, v_admin_profile_id)
    returning id into v_version_id;

    insert into public.knowledge_version_pages
      (workspace_id, document_id, version_id, page_no, content)
    values (v_workspace_id, v_document_id, v_version_id, 1, v_item.source_text);
    insert into public.knowledge_chunks
      (workspace_id, document_id, version_id, ordinal, page_no, section_label, content)
    values (v_workspace_id, v_document_id, v_version_id, 1, 1,
      'Page 1, section 1', v_item.source_text);

    update public.knowledge_documents
    set state = 'PUBLISHED', published_version_id = v_version_id,
      updated_at = clock_timestamp()
    where workspace_id = v_workspace_id and id = v_document_id;
  end loop;
  return true;
end;
$$;
revoke execute on function private.demo_seed_knowledge()
  from public, anon, authenticated, service_role;
grant execute on function private.demo_seed_knowledge() to service_role;

-- Retain the existing order seed contract and add the independent KB seed
-- before its existing-customer/order early return. Fresh bootstrap and Demo
-- reset already call this private function through service-only paths.
create or replace function private.demo_seed()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_admin_profile_id uuid;
  v_technician_id uuid;
  v_admin_count integer;
  v_technician_count integer;
begin
  select w.id into v_workspace_id
  from public.workspaces w where w.kind = 'DEMO' and w.active for update;
  if v_workspace_id is null then
    raise exception 'DEMO_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select count(*)::integer, (array_agg(p.id))[1]
  into v_admin_count, v_admin_profile_id
  from public.profiles p
  join auth.users u on u.id = p.auth_user_id
  join public.workspace_memberships m on m.profile_id = p.id
  where m.workspace_id = v_workspace_id and m.active and m.role = 'ADMIN'
    and p.active and p.demo_principal and p.platform_role = 'USER'
    and p.role = 'ADMIN' and not u.is_anonymous;
  select count(*)::integer, (array_agg(t.id))[1]
  into v_technician_count, v_technician_id
  from public.workspace_technicians t
  join public.workspace_memberships m
    on m.workspace_id = t.workspace_id and m.profile_id = t.profile_id
  join public.profiles p on p.id = t.profile_id
  join auth.users u on u.id = p.auth_user_id
  where t.workspace_id = v_workspace_id and t.active
    and m.active and m.role = 'TECHNICIAN'
    and p.active and p.demo_principal and p.platform_role = 'USER'
    and p.role = 'TECHNICIAN' and not u.is_anonymous;
  if v_admin_count = 0 or v_technician_count = 0 then return false; end if;
  if v_admin_count <> 1 or v_technician_count <> 1 then
    raise exception 'DEMO_PRINCIPAL_AMBIGUOUS' using errcode = 'P0001';
  end if;

  perform private.demo_seed_knowledge();
  if exists (select 1 from public.workspace_customers where workspace_id = v_workspace_id)
     or exists (select 1 from public.workspace_orders where workspace_id = v_workspace_id) then
    return false;
  end if;
  select id into v_branch_id from public.workspace_branches
  where workspace_id = v_workspace_id and code = 'DEMO-HQ' and active;
  if v_branch_id is null then
    raise exception 'DEMO_BRANCH_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.workspace_customers (workspace_id, name, address)
  values (v_workspace_id, 'Demo Customer', 'Fictional service area')
  returning id into v_customer_id;

  insert into public.workspace_orders (
    workspace_id, order_no, branch_id, customer_id, assigned_technician_id,
    problem_description, service_type, status, scheduled_at,
    created_by_profile_id, created_at, updated_at
  ) values
    (v_workspace_id, 'DEMO-001', v_branch_id, v_customer_id, null,
     'Air conditioner is not cooling in the demonstration reception area.',
     'Air conditioner inspection', 'NEW', null,
     v_admin_profile_id, now() - interval '3 hours', now() - interval '3 hours'),
    (v_workspace_id, 'DEMO-002', v_branch_id, v_customer_id, v_technician_id,
     'Water leaks from the demonstration unit during operation.',
     'Air conditioner repair', 'ASSIGNED', now() + interval '1 day',
     v_admin_profile_id, now() - interval '2 hours', now() - interval '2 hours'),
    (v_workspace_id, 'DEMO-003', v_branch_id, v_customer_id, v_technician_id,
     'Demonstration unit requires filter cleaning and airflow check.',
     'Preventive maintenance', 'IN_PROGRESS', now() - interval '1 hour',
     v_admin_profile_id, now() - interval '1 hour', now() - interval '1 hour'),
    (v_workspace_id, 'DEMO-004', v_branch_id, v_customer_id, v_technician_id,
     'Demonstration unit was inspected and cooling was restored.',
     'Air conditioner repair', 'COMPLETED', now() - interval '2 days',
     v_admin_profile_id, now() - interval '3 days', now() - interval '2 days');
  return true;
end;
$$;
revoke execute on function private.demo_seed()
  from public, anon, authenticated;
grant execute on function private.demo_seed() to service_role;

-- On the confirmed Test project, existing Demo orders remain untouched while
-- the empty KB receives the two fixed references. On fresh setup this returns
-- false until the three Demo principals are created, then bootstrap reseeds.
select private.demo_seed_knowledge();
