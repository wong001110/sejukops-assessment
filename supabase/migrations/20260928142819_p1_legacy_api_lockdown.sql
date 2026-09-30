-- P1 cutover gate: no newly authenticated Demo/Owner user may reach the
-- assessment-era global tables, RPCs, or service-evidence object policy.
-- Existing legacy server services use service_role while they are retired.

revoke all privileges on all tables in schema public
  from public, anon, authenticated;
revoke all privileges on all sequences in schema public
  from public, anon, authenticated;
revoke execute on all functions in schema public
  from public, anon, authenticated;

-- Supabase server-side legacy adapters still require their explicit key while
-- P1 replaces them. These grants do not confer client-side authority.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- The new Auth resolver and workspace read path use the caller's JWT and RLS.
grant select on public.profiles,
  public.workspaces,
  public.workspace_memberships,
  public.workspace_branches,
  public.workspace_technicians,
  public.workspace_customers,
  public.workspace_orders
  to authenticated;

-- Supabase's postgres default ACL currently grants new public objects to
-- anon/authenticated. Future migrations must grant API access deliberately.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- The old bucket is private, but these order-ID-only policies omit workspace.
-- Service-role signed URLs remain available to old server code until replaced.
drop policy if exists service_evidence_read_scoped on storage.objects;
drop policy if exists service_evidence_insert_assigned on storage.objects;
drop policy if exists service_evidence_delete_assigned_or_office on storage.objects;
