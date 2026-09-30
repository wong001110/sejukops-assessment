-- Narrow service-only counts for the one-shot live reset verifier. No row
-- contents, Auth identifiers, or Owner workspace data are exposed.
create function private.demo_reset_inventory()
returns jsonb language sql security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'workspaceId', w.id,
    'generation', w.generation,
    'branches', (select count(*) from public.workspace_branches b where b.workspace_id = w.id),
    'orders', (select count(*) from public.workspace_orders o where o.workspace_id = w.id),
    'technicians', (select count(*) from public.workspace_technicians t where t.workspace_id = w.id),
    'customers', (select count(*) from public.workspace_customers c where c.workspace_id = w.id),
    'memberships', (select count(*) from public.workspace_memberships m where m.workspace_id = w.id),
    'proposals', (select count(*) from public.workspace_assignment_proposals p where p.workspace_id = w.id),
    'proposalAudit', (select count(*) from public.workspace_assignment_proposal_audit a where a.workspace_id = w.id),
    'knowledgeDocuments', (select count(*) from public.knowledge_documents d where d.workspace_id = w.id),
    'knowledgeVersions', (select count(*) from public.knowledge_versions v where v.workspace_id = w.id),
    'knowledgeChunks', (select count(*) from public.knowledge_chunks k where k.workspace_id = w.id)
  ) from public.workspaces w where w.kind = 'DEMO' and w.active;
$$;
create function public.demo_reset_inventory()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.demo_reset_inventory();
$$;
revoke execute on function private.demo_reset_inventory() from public, anon, authenticated;
revoke execute on function public.demo_reset_inventory() from public, anon, authenticated;
grant execute on function private.demo_reset_inventory() to service_role;
grant execute on function public.demo_reset_inventory() to service_role;
