-- Session-held Owner perspectives retain the actual Owner subject. No credentials
-- or employee session are issued. Invalid state remains restrictive until exit.
create table private.owner_previews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references auth.sessions(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role public.app_role not null check (role in ('ADMIN','MANAGER','TECHNICIAN')),
  -- Preserve the record if an employee disappears; revalidation then fails closed.
  effective_employee_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at>created_at and expires_at<=created_at+interval '1 hour')
);
alter table private.owner_previews enable row level security;
revoke all on private.owner_previews from public,anon,authenticated,service_role;
create index owner_previews_actor_idx on private.owner_previews(auth_user_id,workspace_id);

create function private.owner_preview_employee_valid(p_workspace_id uuid,p_profile_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists(select 1 from private.staff_accounts s
    join public.profiles p on p.id=s.profile_id
    join auth.users u on u.id=p.auth_user_id
    join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.profile_id=s.profile_id
    join public.workspace_technicians t on t.workspace_id=s.workspace_id and t.profile_id=s.profile_id
    join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
    where s.workspace_id=p_workspace_id and s.profile_id=p_profile_id and p.active
      and p.platform_role='USER' and not p.demo_principal and not u.is_anonymous
      and s.auth_user_id=p.auth_user_id and m.active and m.role='TECHNICIAN' and t.active and b.active);
$$;
revoke all on function private.owner_preview_employee_valid(uuid,uuid) from public,anon,authenticated,service_role;

create function private.owner_preview_valid(p_preview_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists(select 1 from private.owner_previews v
    join auth.sessions a on a.id=v.session_id and a.user_id=v.auth_user_id
    join auth.users u on u.id=v.auth_user_id
    join public.profiles p on p.id=v.owner_profile_id and p.auth_user_id=v.auth_user_id
    join public.workspace_memberships m on m.workspace_id=v.workspace_id and m.profile_id=p.id
    join public.workspaces w on w.id=v.workspace_id
    where v.id=p_preview_id and v.expires_at>clock_timestamp()
      and (a.not_after is null or a.not_after>clock_timestamp()) and not u.is_anonymous
      and p.active and p.platform_role='SUPER_ADMIN' and not p.demo_principal
      and m.active and w.active and w.kind='OWNER'
      and ((v.role in ('ADMIN','MANAGER') and v.effective_employee_profile_id is null)
        or (v.role='TECHNICIAN' and private.owner_preview_employee_valid(v.workspace_id,v.effective_employee_profile_id))));
$$;
revoke all on function private.owner_preview_valid(uuid) from public,anon,authenticated,service_role;

create function private.owner_preview_assert_owner(p_workspace_id uuid,p_lock boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_profile_id uuid; v_uid uuid := (select auth.uid());
begin
  -- UPDATE serializes preview transitions against command guards' profile SHARE.
  if p_lock then
    select id into v_profile_id from public.profiles where auth_user_id=v_uid for update;
  end if;
  return private.staff_assert_owner(v_uid,private.staff_signed_session_id(),p_workspace_id);
end;
$$;
revoke all on function private.owner_preview_assert_owner(uuid,boolean) from public,anon,authenticated,service_role;

create function private.owner_preview_json(p_preview_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v private.owner_previews; v_name text;
begin
  select * into v from private.owner_previews where id=p_preview_id;
  if v.id is null or not private.owner_preview_valid(v.id) then
    raise exception 'OWNER_PREVIEW_INVALID_EXIT_REQUIRED' using errcode='42501'; end if;
  select display_name into v_name from public.profiles where id=v.effective_employee_profile_id;
  return jsonb_build_object('previewId',v.id,'role',v.role,
    'effectiveEmployeeProfileId',v.effective_employee_profile_id,'effectiveEmployeeName',v_name,'readOnly',true);
end;
$$;
revoke all on function private.owner_preview_json(uuid) from public,anon,authenticated,service_role;

create function private.owner_preview_audit(p_preview_id uuid,p_event text)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(id,actor_profile_id,event_type,metadata_json)
    select gen_random_uuid(),v.owner_profile_id,p_event,
      jsonb_build_object('actualOwnerProfileId',v.owner_profile_id,'actualOwnerAuthUserId',v.auth_user_id,
        'workspaceId',v.workspace_id,'previewId',v.id,'role',v.role,
        'effectiveEmployeeProfileId',v.effective_employee_profile_id,'readOnly',true)
    from private.owner_previews v where v.id=p_preview_id;
$$;
revoke all on function private.owner_preview_audit(uuid,text) from public,anon,authenticated,service_role;

create function public.owner_preview_options(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.owner_preview_assert_owner(p_workspace_id);
  return jsonb_build_object('technicians',coalesce((select jsonb_agg(jsonb_build_object(
    'profileId',p.id,'name',p.display_name,'branchCode',b.code) order by p.display_name,p.id)
    from public.profiles p join public.workspace_technicians t on t.profile_id=p.id
    join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
    where t.workspace_id=p_workspace_id and private.owner_preview_employee_valid(p_workspace_id,p.id)),'[]'::jsonb));
end;
$$;
revoke all on function public.owner_preview_options(uuid) from public,anon,authenticated;
grant execute on function public.owner_preview_options(uuid) to authenticated;

create function public.owner_preview_set(p_workspace_id uuid,p_role public.app_role,p_employee_profile_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_session uuid := private.staff_signed_session_id(); v_old private.owner_previews;
  v_id uuid; v_now timestamptz;
begin
  v_owner := private.owner_preview_assert_owner(p_workspace_id,true);
  if p_role is null or p_role not in ('ADMIN','MANAGER','TECHNICIAN')
    or (p_role in ('ADMIN','MANAGER') and p_employee_profile_id is not null)
    or (p_role='TECHNICIAN' and not private.owner_preview_employee_valid(p_workspace_id,p_employee_profile_id)) then
    raise exception 'OWNER_PREVIEW_SELECTION_INVALID' using errcode='22023'; end if;
  select * into v_old from private.owner_previews where session_id=v_session for update;
  if v_old.id is not null then
    if not private.owner_preview_valid(v_old.id) then
      raise exception 'OWNER_PREVIEW_INVALID_EXIT_REQUIRED' using errcode='42501'; end if;
    perform private.owner_preview_audit(v_old.id,'OWNER_PREVIEW_ENDED');
    delete from private.owner_previews where id=v_old.id;
  end if;
  v_now := clock_timestamp();
  insert into private.owner_previews(session_id,auth_user_id,owner_profile_id,workspace_id,role,
    effective_employee_profile_id,created_at,expires_at)
    values(v_session,(select auth.uid()),v_owner,p_workspace_id,p_role,p_employee_profile_id,v_now,v_now+interval '1 hour')
    returning id into v_id;
  perform private.owner_preview_audit(v_id,'OWNER_PREVIEW_STARTED');
  return private.owner_preview_json(v_id);
end;
$$;
revoke all on function public.owner_preview_set(uuid,public.app_role,uuid) from public,anon,authenticated;
grant execute on function public.owner_preview_set(uuid,public.app_role,uuid) to authenticated;

create function public.owner_preview_status(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v private.owner_previews;
begin
  perform private.owner_preview_assert_owner(p_workspace_id);
  select * into v from private.owner_previews where session_id=private.staff_signed_session_id();
  if v.id is null then return null; end if;
  if v.workspace_id<>p_workspace_id or v.auth_user_id<>(select auth.uid()) then
    raise exception 'OWNER_PREVIEW_INVALID_EXIT_REQUIRED' using errcode='42501'; end if;
  return private.owner_preview_json(v.id);
end;
$$;
revoke all on function public.owner_preview_status(uuid) from public,anon,authenticated;
grant execute on function public.owner_preview_status(uuid) to authenticated;

create function public.owner_preview_exit()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v private.owner_previews; v_uid uuid := (select auth.uid()); v_profile_id uuid; v_workspace_id uuid;
begin
  -- Always lock before reading state, including a no-op exit racing with entry.
  select id into v_profile_id from public.profiles where auth_user_id=v_uid for update;
  select * into v from private.owner_previews where session_id=private.staff_signed_session_id() for update;
  if v.id is null then
    select w.id into v_workspace_id from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id
      where m.profile_id=v_profile_id and m.active and w.active and w.kind='OWNER';
    if v_workspace_id is null then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501'; end if;
    perform private.owner_preview_assert_owner(v_workspace_id,true);
    return false;
  end if;
  perform private.owner_preview_assert_owner(v.workspace_id,true);
  if v.auth_user_id is distinct from v_uid then raise exception 'STAFF_OWNER_REQUIRED' using errcode='42501'; end if;
  perform private.owner_preview_audit(v.id,'OWNER_PREVIEW_ENDED');
  delete from private.owner_previews where id=v.id;
  return true;
end;
$$;
revoke all on function public.owner_preview_exit() from public,anon,authenticated;
grant execute on function public.owner_preview_exit() to authenticated;

-- Called only with the signed caller. SECURITY DEFINER avoids RLS recursion while
-- returning a boolean, never employee rows or another caller's preview state.
create function private.owner_preview_read_allowed(p_workspace_id uuid,p_kind text,p_row_id uuid,p_version_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v private.owner_previews; v_profile uuid; v_role public.app_role; v_technician uuid; v_branch uuid;
begin
  select * into v from private.owner_previews where session_id=private.staff_signed_session_id();
  if v.id is not null then
    if v.auth_user_id is distinct from (select auth.uid()) or v.workspace_id<>p_workspace_id
      or not private.owner_preview_valid(v.id) then return false; end if;
    v_role := v.role; v_profile := v.effective_employee_profile_id;
    if p_kind='proposals' then
      if v_role='TECHNICIAN' then return false; end if;
      return exists(select 1 from public.workspace_assignment_proposals a where a.workspace_id=p_workspace_id and a.id=p_row_id
        and (a.initiated_by_profile_id=v.owner_profile_id or a.approver_profile_id=v.owner_profile_id));
    end if;
    if p_kind in ('documents','versions','chunks','pages') then
      return exists(select 1 from public.knowledge_documents d
        join public.workspaces w on w.id=d.workspace_id
        join public.knowledge_versions k on k.workspace_id=d.workspace_id and k.document_id=d.id and k.id=d.published_version_id
        where d.workspace_id=p_workspace_id and d.id=p_row_id and w.active and d.generation=w.generation
          and k.generation=w.generation and d.state='PUBLISHED' and k.index_state='READY'
          and (p_kind='documents' or k.id=p_version_id));
    end if;
  else
    -- Only formal managed Technicians receive the additional directory fence.
    select p.id,m.role into v_profile,v_role from public.profiles p
      join private.staff_accounts s on s.profile_id=p.id and s.workspace_id=p_workspace_id
      join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.profile_id=p.id
      where p.auth_user_id=(select auth.uid()) and p.active and m.active;
    if v_role is distinct from 'TECHNICIAN'::public.app_role then return true; end if;
    if p_kind not in ('orders','customers','technicians','branches') then return true; end if;
  end if;
  if v_role='ADMIN' then return p_kind in ('orders','customers','technicians','branches'); end if;
  if v_role='MANAGER' then
    -- Manager read visibility matches the real role; scheduling eligibility is
    -- checked separately by command code, which previews cannot execute.
    return p_kind in ('orders','customers','technicians','branches');
  end if;
  select t.id,t.branch_id into v_technician,v_branch from public.workspace_technicians t
    join public.workspace_branches b on b.workspace_id=t.workspace_id and b.id=t.branch_id
    where t.workspace_id=p_workspace_id and t.profile_id=v_profile and t.active and b.active;
  if v_technician is null then return false; end if;
  if p_kind='orders' then return exists(select 1 from public.workspace_orders o where o.workspace_id=p_workspace_id
    and o.id=p_row_id and o.assigned_technician_id=v_technician); end if;
  if p_kind='customers' then return exists(select 1 from public.workspace_orders o where o.workspace_id=p_workspace_id
    and o.customer_id=p_row_id and o.assigned_technician_id=v_technician); end if;
  if p_kind='technicians' then return p_row_id=v_technician; end if;
  if p_kind='branches' then return p_row_id=v_branch; end if;
  -- Other normal Technician roots retain their existing RLS behavior.
  return v.id is null;
end;
$$;
revoke all on function private.owner_preview_read_allowed(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.owner_preview_read_allowed(uuid,text,uuid,uuid) to authenticated;

create policy workspace_orders_owner_preview on public.workspace_orders as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'orders',id));
create policy workspace_customers_owner_preview on public.workspace_customers as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'customers',id));
create policy workspace_technicians_owner_preview on public.workspace_technicians as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'technicians',id));
create policy workspace_branches_owner_preview on public.workspace_branches as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'branches',id));
create policy workspace_assignment_proposals_owner_preview on public.workspace_assignment_proposals as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'proposals',id));
create policy knowledge_documents_owner_preview on public.knowledge_documents as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'documents',id));
create policy knowledge_versions_owner_preview on public.knowledge_versions as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'versions',document_id,id));
create policy knowledge_chunks_owner_preview on public.knowledge_chunks as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'chunks',document_id,version_id));
create policy knowledge_version_pages_owner_preview on public.knowledge_version_pages as restrictive for select to authenticated
  using (private.owner_preview_read_allowed(workspace_id,'pages',document_id,version_id));

-- Replace the same function OID; cached business callers retain this gate.
create or replace function private.staff_actor_ready(
  p_auth_user_id uuid, p_workspace_id uuid, p_session_id uuid,
  p_lock boolean default false, p_allow_password_pending boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_staff private.staff_accounts; v_fingerprint text;
begin
  if p_auth_user_id is null then return false; end if;
  if p_lock then
    select * into v_profile from public.profiles where auth_user_id = p_auth_user_id for share;
  else
    select * into v_profile from public.profiles where auth_user_id = p_auth_user_id;
  end if;
  if v_profile.id is null or not v_profile.active then return false; end if;
  -- Invalid/expired previews still deny commands until explicit exit. A service
  -- caller omitting proof cannot select a preview-free session by using NULL.
  if p_lock and exists(select 1 from private.owner_previews v
    where v.auth_user_id=p_auth_user_id
      and (p_workspace_id is null or v.workspace_id=p_workspace_id)
      and (p_session_id is null or v.session_id=p_session_id)) then return false; end if;
  -- Supplied permanent Owner proof must stay live after preview FK cleanup.
  -- Legacy NULL proof remains compatible; this is not full legacy JWT revocation.
  if v_profile.platform_role='SUPER_ADMIN' and not v_profile.demo_principal and p_session_id is not null then
    if p_lock then
      perform 1 from auth.sessions a join auth.users u on u.id=a.user_id
        where a.id=p_session_id and a.user_id=p_auth_user_id and not u.is_anonymous
          and (a.not_after is null or a.not_after>clock_timestamp()) for share of a;
    else
      perform 1 from auth.sessions a join auth.users u on u.id=a.user_id
        where a.id=p_session_id and a.user_id=p_auth_user_id and not u.is_anonymous
          and (a.not_after is null or a.not_after>clock_timestamp());
    end if;
    if not found then return false; end if;
  end if;
  if p_lock then
    select * into v_staff from private.staff_accounts where profile_id = v_profile.id for share;
  else
    select * into v_staff from private.staff_accounts where profile_id = v_profile.id;
  end if;
  if v_staff.profile_id is null then return true; end if;
  v_fingerprint := private.staff_auth_password_fingerprint(p_auth_user_id);
  if v_fingerprint is null then return false; end if;
  if v_profile.platform_role <> 'USER' or v_profile.demo_principal
    or v_staff.auth_user_id <> p_auth_user_id
    or (p_workspace_id is not null and p_workspace_id <> v_staff.workspace_id)
    or (not p_allow_password_pending and (v_staff.password_change_required
      or not coalesce(private.staff_password_current(v_profile.id),false)))
    or p_session_id is null then return false; end if;
  if p_lock then
    perform 1 from public.workspace_memberships m
      where m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active for share;
  else
    perform 1 from public.workspace_memberships m
      where m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active;
  end if;
  if not found then return false; end if;
  return exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    join public.workspaces w on w.id = v_staff.workspace_id
    where s.id = p_session_id and s.user_id = p_auth_user_id
      and s.created_at > v_staff.sessions_valid_after
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.is_anonymous is false and w.active and w.kind = 'OWNER'
  );
end;
$$;
