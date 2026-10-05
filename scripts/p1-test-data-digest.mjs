// Stable digest of all application rows plus the four managed Auth identities.
// Only the digest is returned; raw rows and credential hashes stay in PostgreSQL.
export function testDataDigestSql(baseline) {
  const tables = [...baseline.matchAll(/^CREATE TABLE (public|private)\.([a-z_][a-z_0-9]*)\s*\(/gm)]
    .map(([, schema, table]) => `${schema}.${table}`);
  if (tables.length !== 24 || new Set(tables).size !== 24) {
    throw new Error('Reviewed Test application table set changed');
  }
  return digestTables(tables);
}

// Read-only backup support for the reviewed staff extension. Historical replay
// and restore callers retain their original 24-table guard above.
export function staffBackupDataDigestSql(baseline) {
  const tables = [...baseline.matchAll(/^CREATE TABLE (public|private)\.([a-z_][a-z_0-9]*)\s*\(/gm)]
    .map(([, schema, table]) => `${schema}.${table}`);
  const expected = [
    'private.guest_ai_budget_counter', 'private.guest_ai_budget_policy',
    'private.knowledge_pdf_stage_attestations', 'private.owner_previews',
    'private.staff_accounts', 'private.staff_import_rows', 'private.staff_imports',
    'private.staff_password_claims', 'private.staff_password_resets', 'private.staff_provisioning',
    'private.workspace_order_activity_audit', 'private.workspace_order_manual_audit',
    'private.workspace_order_schedule_audit', 'public.ai_provider_configs', 'public.ai_settings',
    'public.ai_task_routes', 'public.audit_logs', 'public.guest_visits', 'public.knowledge_chunks',
    'public.knowledge_documents', 'public.knowledge_version_pages', 'public.knowledge_versions',
    'public.profiles', 'public.workspace_assignment_proposal_audit', 'public.workspace_assignment_proposals',
    'public.workspace_branches', 'public.workspace_customers', 'public.workspace_memberships',
    'public.workspace_orders', 'public.workspace_technicians', 'public.workspaces',
  ];
  if (tables.length !== expected.length || new Set(tables).size !== expected.length
    || tables.some(name => !expected.includes(name))) {
    throw new Error('Reviewed staff backup application table set changed');
  }
  return digestTables(tables);
}

function digestTables(tables) {
  const parts = tables.map(name =>
    `select '${name}' as source, md5(to_jsonb(t)::text) as row_hash from ${name} t`);
  parts.push(`select 'auth.users' as source,
    md5(to_jsonb(row(u.id,lower(u.email),u.encrypted_password,
      u.email_confirmed_at,u.is_anonymous))::text) as row_hash from auth.users u`);
  return `with row_hashes as (${parts.join('\nunion all\n')})
select md5(coalesce(string_agg(source || ':' || row_hash, E'\\n'
  order by source,row_hash),'')) from row_hashes;`;
}

export function testAuthDigestSql() {
  return `select md5(coalesce(string_agg(
    md5(to_jsonb(row(u.id,lower(u.email),u.encrypted_password,
      u.email_confirmed_at,u.is_anonymous))::text), E'\\n' order by u.id),''))
    from auth.users u;`;
}
