-- Every manual order write carries the generation observed by the caller.
-- Holding a workspace row lock until commit serializes these writes with a
-- Demo reset, which updates the same row before deleting/reseeding records.
create function private.workspace_order_require_generation(
  p_workspace_id uuid, p_expected_generation bigint
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_generation bigint;
begin
  perform private.workspace_order_admin_profile(p_workspace_id);
  select generation into v_generation from public.workspaces
  where id = p_workspace_id and active for share;
  if v_generation is null or p_expected_generation is null
    or v_generation <> p_expected_generation then
    raise exception 'WORKSPACE_GENERATION_STALE' using errcode = 'P0001';
  end if;
end;
$$;

create function private.workspace_order_create_current(
  p_workspace_id uuid, p_expected_generation bigint, p_order_no text,
  p_branch_id uuid, p_customer_id uuid, p_problem_description text,
  p_service_type text
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
begin
  perform private.workspace_order_require_generation(p_workspace_id, p_expected_generation);
  return private.workspace_order_create(
    p_workspace_id, p_order_no, p_branch_id, p_customer_id,
    p_problem_description, p_service_type
  );
end;
$$;

create function private.workspace_order_assign_current(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_technician_id uuid, p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz
)
returns public.workspace_orders language plpgsql security definer set search_path = '' as $$
begin
  perform private.workspace_order_require_generation(p_workspace_id, p_expected_generation);
  return private.workspace_order_assign(
    p_workspace_id, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at
  );
end;
$$;

-- Remove the generation-free Data API entry points. The old private assign
-- function remains for the proposal executor, which locks/checks generation.
drop function public.workspace_order_create(uuid,text,uuid,uuid,text,text);
drop function public.workspace_order_assign(uuid,uuid,uuid,timestamptz,timestamptz);
revoke execute on function private.workspace_order_create(uuid,text,uuid,uuid,text,text) from authenticated;
revoke execute on function private.workspace_order_assign(uuid,uuid,uuid,timestamptz,timestamptz) from authenticated;

create function public.workspace_order_create(
  p_workspace_id uuid, p_expected_generation bigint, p_order_no text,
  p_branch_id uuid, p_customer_id uuid, p_problem_description text,
  p_service_type text
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_create_current(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_id, p_problem_description, p_service_type
  );
$$;

create function public.workspace_order_assign(
  p_workspace_id uuid, p_expected_generation bigint, p_order_id uuid,
  p_technician_id uuid, p_expected_updated_at timestamptz,
  p_scheduled_at timestamptz
)
returns public.workspace_orders language sql security invoker set search_path = '' as $$
  select private.workspace_order_assign_current(
    p_workspace_id, p_expected_generation, p_order_id, p_technician_id,
    p_expected_updated_at, p_scheduled_at
  );
$$;

revoke execute on function private.workspace_order_require_generation(uuid,bigint) from public, anon;
revoke execute on function private.workspace_order_create_current(uuid,bigint,text,uuid,uuid,text,text) from public, anon;
revoke execute on function private.workspace_order_assign_current(uuid,bigint,uuid,uuid,timestamptz,timestamptz) from public, anon;
revoke execute on function public.workspace_order_create(uuid,bigint,text,uuid,uuid,text,text) from public, anon;
revoke execute on function public.workspace_order_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function private.workspace_order_require_generation(uuid,bigint) to authenticated;
grant execute on function private.workspace_order_create_current(uuid,bigint,text,uuid,uuid,text,text) to authenticated;
grant execute on function private.workspace_order_assign_current(uuid,bigint,uuid,uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.workspace_order_create(uuid,bigint,text,uuid,uuid,text,text) to authenticated;
grant execute on function public.workspace_order_assign(uuid,bigint,uuid,uuid,timestamptz,timestamptz) to authenticated;
