-- A reviewed document may name a customer not yet in the workspace.
-- Keep customer creation and the ordinary order command in one transaction:
-- duplicate order numbers or stale generations roll back the customer insert.
-- Owner initially has no branch; provide a neutral operational branch without
-- copying any assessment-era customer/order data.
insert into public.workspace_branches (workspace_id, code, name)
select id, 'OWNER-HQ', 'Owner Service Hub'
from public.workspaces where kind = 'OWNER' and active
on conflict (workspace_id, code) do nothing;

create function private.workspace_order_create_with_customer(
  p_workspace_id uuid,
  p_expected_generation bigint,
  p_order_no text,
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_problem_description text,
  p_service_type text
)
returns public.workspace_orders
language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid;
begin
  perform private.workspace_order_require_generation(p_workspace_id, p_expected_generation);
  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 1 and 160
     or p_customer_address is null or char_length(btrim(p_customer_address)) not between 1 and 800
     or (p_customer_phone is not null and
         (char_length(p_customer_phone) > 40 or p_customer_phone !~ '^\+?[0-9][0-9 -]{6,20}$'))
  then
    raise exception 'WORKSPACE_CUSTOMER_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.workspace_customers (workspace_id, name, phone, address)
  values (p_workspace_id, btrim(p_customer_name),
          nullif(btrim(p_customer_phone), ''), btrim(p_customer_address))
  returning id into v_customer_id;

  return private.workspace_order_create(
    p_workspace_id, p_order_no, p_branch_id, v_customer_id,
    p_problem_description, p_service_type
  );
end;
$$;

create function public.workspace_order_create_with_customer(
  p_workspace_id uuid,
  p_expected_generation bigint,
  p_order_no text,
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_problem_description text,
  p_service_type text
)
returns public.workspace_orders
language sql security invoker set search_path = '' as $$
  select private.workspace_order_create_with_customer(
    p_workspace_id, p_expected_generation, p_order_no, p_branch_id,
    p_customer_name, p_customer_phone, p_customer_address,
    p_problem_description, p_service_type
  );
$$;

revoke execute on function private.workspace_order_create_with_customer(
  uuid,bigint,text,uuid,text,text,text,text,text
) from public, anon;
revoke execute on function public.workspace_order_create_with_customer(
  uuid,bigint,text,uuid,text,text,text,text,text
) from public, anon;
grant execute on function private.workspace_order_create_with_customer(
  uuid,bigint,text,uuid,text,text,text,text,text
) to authenticated;
grant execute on function public.workspace_order_create_with_customer(
  uuid,bigint,text,uuid,text,text,text,text,text
) to authenticated;
