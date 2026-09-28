-- The unqualified id in the first policy bound to profiles.id in its inner
-- subquery. Qualify the outer workspace id so a verified member can see it.
drop policy if exists workspaces_read_member on public.workspaces;
create policy workspaces_read_member
  on public.workspaces for select to authenticated
  using (
    workspaces.active and exists (
      select 1
      from public.workspace_memberships m
      join public.profiles p on p.id = m.profile_id
      where m.workspace_id = workspaces.id
        and m.active
        and p.active
        and p.auth_user_id = (select auth.uid())
    )
  );
