-- Secret-free, Owner-bound import drafts and leased batches. Auth provisioning
-- uses the existing per-row operation UUID; retries cannot adopt another user.
create function private.staff_import_input_valid(p_input jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(private.staff_input_valid(p_input,p_input->>'email')
    and jsonb_typeof(p_input->'email')='string'
    and char_length(p_input->>'email') between 3 and 254
    and p_input->>'email'=lower(btrim(p_input->>'email'))
    and p_input->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+$',false);
$$;
revoke all on function private.staff_import_input_valid(jsonb) from public,anon,authenticated;
grant execute on function private.staff_import_input_valid(jsonb) to service_role;
create table private.staff_imports (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id),
  workspace_id uuid not null references public.workspaces(id),
  expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
  confirmed_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  claimed_rows integer[],
  created_at timestamptz not null default clock_timestamp()
);
create table private.staff_import_rows (
  import_id uuid not null references private.staff_imports(id) on delete cascade,
  row_number integer not null check (row_number between 2 and 1001),
  operation_id uuid not null unique default gen_random_uuid(),
  input jsonb not null check (private.staff_import_input_valid(input)),
  state text not null default 'PENDING' check (state in ('PENDING','CREATED','ALREADY_CREATED','FAILED')),
  profile_id uuid,
  error_code text check (error_code in ('STAFF_CONFLICT','STAFF_INVALID_INPUT','STAFF_UNAVAILABLE')),
  primary key (import_id,row_number)
);
create unique index staff_import_email_unique on private.staff_import_rows(import_id,(input->>'email'));
alter table private.staff_imports enable row level security;
alter table private.staff_import_rows enable row level security;
revoke all on private.staff_imports,private.staff_import_rows from public,anon,authenticated;
grant all on private.staff_imports,private.staff_import_rows to service_role;

create function public.staff_preview_import(p_owner_auth_user_id uuid,p_owner_session_id uuid,
  p_workspace_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid := gen_random_uuid(); v_expires timestamptz := clock_timestamp()+interval '30 minutes';
  v_row jsonb; v_input jsonb; v_error text; v_rows jsonb := '[]'::jsonb; v_invalid int := 0;
  v_seen_rows int[] := '{}'; v_seen_emails text[] := '{}';
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_input := v_row->'input';
    if jsonb_typeof(v_row) is distinct from 'object' or (v_row-array['row','input']) <> '{}'::jsonb
      or not (v_row ?& array['row','input']) or coalesce(v_row->>'row','') !~ '^[0-9]{1,4}$'
      or (v_row->>'row')::int not between 2 and 1001
      or not private.staff_import_input_valid(v_input)
      or (v_row->>'row')::int = any(v_seen_rows) or v_input->>'email' = any(v_seen_emails) then
      raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
    v_seen_rows := array_append(v_seen_rows,(v_row->>'row')::int);
    v_seen_emails := array_append(v_seen_emails,v_input->>'email');
    v_error := null;
    if v_input->>'role' = 'TECHNICIAN' and not exists(select 1 from public.workspace_branches b
      where b.workspace_id=p_workspace_id and b.code=v_input->>'branchCode' and b.active) then
      v_error := 'Choose an active branch in this workspace.';
    elsif exists(select 1 from auth.users u where lower(u.email)=v_input->>'email')
      or exists(select 1 from private.staff_provisioning p where p.email=v_input->>'email') then
      v_error := 'This email is already in use or reserved; imports only create new accounts.';
    end if;
    if v_error is not null then v_invalid := v_invalid+1; end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('row',(v_row->>'row')::int,'input',v_input,
      'errors',case when v_error is null then '[]'::jsonb else jsonb_build_array(v_error) end));
  end loop;
  -- An invalid preview cannot ever be confirmed. Its ID is only a display token.
  if v_invalid = 0 then
    insert into private.staff_imports(id,owner_profile_id,workspace_id,expires_at) values(v_id,v_owner,p_workspace_id,v_expires);
    insert into private.staff_import_rows(import_id,row_number,input)
      select v_id,(value->>'row')::int,value->'input' from jsonb_array_elements(p_rows);
  end if;
  return jsonb_build_object('importId',v_id,'expiresAt',v_expires,'rows',v_rows,
    'validCount',jsonb_array_length(p_rows)-v_invalid,'invalidCount',v_invalid);
end;
$$;

create function public.staff_claim_import(p_owner_auth_user_id uuid,p_owner_session_id uuid,
  p_workspace_id uuid,p_import_id uuid,p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_import private.staff_imports; v_rows jsonb;
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_import from private.staff_imports where id=p_import_id for update;
  if v_import.id is null or v_import.owner_profile_id <> v_owner or v_import.workspace_id <> p_workspace_id
    or v_import.expires_at <= clock_timestamp() then raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
  if v_import.claim_expires_at > clock_timestamp() then raise exception 'STAFF_BUSY' using errcode='55P03'; end if;
  if p_retry_failed then update private.staff_import_rows set state='PENDING',error_code=null
    where import_id=p_import_id and state='FAILED'; end if;
  update private.staff_imports set claim_token=gen_random_uuid(),claim_expires_at=clock_timestamp()+interval '2 minutes',
    expires_at=case when confirmed_at is null then clock_timestamp()+interval '24 hours' else expires_at end,
    confirmed_at=coalesce(confirmed_at,clock_timestamp()),claimed_rows=array(select row_number from private.staff_import_rows
      where import_id=p_import_id and state='PENDING' order by row_number limit 10)
    where id=p_import_id returning * into v_import;
  select coalesce(jsonb_agg(jsonb_build_object('row',r.row_number,'requestKey',r.operation_id,'input',r.input)
    order by r.row_number),'[]'::jsonb) into v_rows from (
      select * from private.staff_import_rows where import_id=p_import_id and state='PENDING' order by row_number limit 10
    ) r;
  return jsonb_build_object('claimToken',v_import.claim_token,'rows',v_rows);
end;
$$;

create function public.staff_finish_import_batch(p_owner_auth_user_id uuid,p_owner_session_id uuid,
  p_workspace_id uuid,p_import_id uuid,p_claim_token uuid,p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_import private.staff_imports; v_result jsonb; v_row private.staff_import_rows;
  v_operation private.staff_provisioning; v_seen int[] := '{}';
begin
  v_owner := private.staff_assert_owner(p_owner_auth_user_id,p_owner_session_id,p_workspace_id);
  select * into v_import from private.staff_imports where id=p_import_id for update;
  if v_import.id is null or v_import.owner_profile_id <> v_owner or v_import.workspace_id <> p_workspace_id
    or p_claim_token is null or v_import.claim_token is distinct from p_claim_token
    or v_import.claim_expires_at <= clock_timestamp() then raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results)>10 then
    raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result) is distinct from 'object' or (v_result-array['row','status','profileId','errorCode']) <> '{}'::jsonb
      or not (v_result ?& array['row','status'])
      or coalesce(v_result->>'row','') !~ '^[0-9]{1,4}$' or coalesce(v_result->>'status','') not in ('CREATED','ALREADY_CREATED','FAILED')
      or not ((v_result->>'row')::int=any(v_import.claimed_rows))
      or (v_result->>'row')::int=any(v_seen) then raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
    v_seen := array_append(v_seen,(v_result->>'row')::int);
    select * into v_row from private.staff_import_rows where import_id=p_import_id and row_number=(v_result->>'row')::int for update;
    if v_row.import_id is null or v_row.state <> 'PENDING' then raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505'; end if;
    if v_result->>'status' in ('CREATED','ALREADY_CREATED') then
      select * into v_operation from private.staff_provisioning where id=v_row.operation_id;
      if v_operation.id is null or v_operation.state <> 'CREATED' or v_operation.owner_profile_id <> v_owner
        or v_operation.workspace_id <> p_workspace_id or v_operation.input <> v_row.input
        or v_result->>'profileId' is distinct from v_operation.target_profile_id::text then
        raise exception 'STAFF_REQUEST_CONFLICT' using errcode='23505'; end if;
      update private.staff_import_rows set state=v_result->>'status',profile_id=v_operation.target_profile_id,error_code=null
        where import_id=p_import_id and row_number=v_row.row_number;
    else
      if coalesce(v_result->>'errorCode','') not in ('STAFF_CONFLICT','STAFF_INVALID_INPUT','STAFF_UNAVAILABLE') then
        raise exception 'STAFF_INVALID_INPUT' using errcode='22023'; end if;
      update private.staff_import_rows set state='FAILED',error_code=v_result->>'errorCode' where import_id=p_import_id and row_number=v_row.row_number;
    end if;
  end loop;
  update private.staff_imports set claim_token=null,claim_expires_at=null,claimed_rows=null where id=p_import_id;
  return jsonb_build_object('complete',not exists(select 1 from private.staff_import_rows where import_id=p_import_id and state='PENDING'),
    'results',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('row',r.row_number,'status',r.state,
      'profileId',r.profile_id,'error',case when r.state='FAILED' then
      case r.error_code when 'STAFF_CONFLICT' then 'Account conflict; refresh and retry failed rows.'
        when 'STAFF_INVALID_INPUT' then 'Role or branch is no longer available.' else 'Creation could not finish; retry failed rows.' end end)) order by r.row_number)
      from private.staff_import_rows r where r.import_id=p_import_id and r.state<>'PENDING'),'[]'::jsonb));
end;
$$;
revoke all on function public.staff_preview_import(uuid,uuid,uuid,jsonb),public.staff_claim_import(uuid,uuid,uuid,uuid,boolean),
  public.staff_finish_import_batch(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_preview_import(uuid,uuid,uuid,jsonb),public.staff_claim_import(uuid,uuid,uuid,uuid,boolean),
  public.staff_finish_import_batch(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
