-- An anonymous Auth user must not see Owner workspace metadata even if a
-- provisioning error inserts an Owner membership for that user.
create function private.workspace_member_can_read(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspaces w
    join public.workspace_memberships m on m.workspace_id = w.id
    join public.profiles p on p.id = m.profile_id
    where w.id = p_workspace_id
      and w.active and m.active and p.active
      and p.auth_user_id = (select auth.uid())
      and (
        (select (auth.jwt()->>'is_anonymous')::boolean) is false
        or w.kind = 'DEMO'
      )
  );
$$;

revoke execute on function private.workspace_member_can_read(uuid)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.workspace_member_can_read(uuid) to authenticated;

drop policy if exists workspaces_read_member on public.workspaces;
create policy workspaces_read_member
  on public.workspaces for select to authenticated
  using (private.workspace_member_can_read(id));

drop policy if exists workspace_memberships_read_self on public.workspace_memberships;
create policy workspace_memberships_read_self
  on public.workspace_memberships for select to authenticated
  using (
    private.workspace_member_can_read(workspace_id)
    and exists (
      select 1 from public.profiles p
      where p.id = workspace_memberships.profile_id
        and p.active
        and p.auth_user_id = (select auth.uid())
    )
  );
