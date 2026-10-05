// Static, read-only preflight for a separate current-schema baseline.
// A PASS here never replaces replay against a disposable empty database.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RETIREMENT = '20260929070000_p6_retire_assessment_database.sql';
export const REQUIRED_TABLES = [
  'profiles', 'workspaces', 'workspace_memberships', 'workspace_branches',
  'workspace_technicians', 'workspace_customers', 'workspace_orders',
  'workspace_assignment_proposals', 'workspace_assignment_proposal_audit',
  'knowledge_documents', 'knowledge_versions', 'knowledge_chunks',
  'knowledge_version_pages', 'guest_visits', 'audit_logs', 'ai_provider_configs',
  'ai_settings',
];
export const REQUIRED_PRIVATE_TABLES = [
  'guest_ai_budget_policy', 'guest_ai_budget_counter',
  'knowledge_pdf_stage_attestations',
  'staff_accounts', 'staff_provisioning', 'staff_password_claims', 'owner_previews',
  'staff_imports', 'staff_import_rows', 'staff_password_resets',
];
export const REQUIRED_FUNCTIONS = [
  'private.demo_seed', 'private.demo_seed_knowledge', 'private.demo_reset', 'public.demo_seed',
  'private.guest_ai_budget_reserve', 'public.guest_ai_budget_reserve',
  'public.workspace_order_create', 'public.knowledge_search_keyword',
  'private.staff_actor_ready', 'private.staff_require_actor', 'private.staff_current_actor_ready',
  'private.staff_password_current', 'public.staff_session_status',
  'public.staff_list', 'public.staff_reserve_creation', 'public.staff_finalize_creation',
  'public.staff_update_account', 'public.staff_issue_password_claim', 'public.staff_complete_password_change',
  'public.owner_preview_options', 'public.owner_preview_set', 'public.owner_preview_status', 'public.owner_preview_exit',
  'public.staff_preview_import', 'public.staff_claim_import', 'public.staff_finish_import_batch',
  'public.staff_reserve_password_reset', 'public.staff_finalize_password_reset',
];
export const STAFF_READ_ROOTS = ['workspaces', 'workspace_memberships', 'workspace_branches',
  'workspace_customers', 'workspace_technicians', 'workspace_orders', 'workspace_assignment_proposals',
  'knowledge_documents', 'knowledge_versions', 'knowledge_chunks', 'knowledge_version_pages'];
export const PREVIEW_READ_ROOTS = STAFF_READ_ROOTS.filter(name => !['workspaces','workspace_memberships'].includes(name));
export const LEGACY_TABLES = [
  'branches', 'technicians', 'customers', 'orders', 'service_reports',
  'service_attachments', 'payments', 'job_reviews', 'notifications',
  'internal_notifications', 'ai_flags', 'document_imports',
  'document_import_extraction_requests',
];
export const LEGACY_PRIVATE_QUOTA_TABLES = [
  'demo_entry_policy', 'demo_entry_counter', 'demo_ai_policy', 'demo_ai_counter',
];
export const LEGACY_QUOTA_FUNCTIONS = [
  'private.demo_entry_reserve', 'public.demo_entry_reserve',
  'private.demo_ai_reserve', 'public.demo_ai_reserve',
];
export const LEGACY_ANONYMOUS_FUNCTIONS = [
  'private.demo_provision_user', 'public.demo_provision_user',
  'private.demo_select_persona', 'public.demo_select_persona',
];

function statementPresent(sql, command, object) {
  const escaped = object.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*create(?:\\s+or\\s+replace)?\\s+${command}\\s+${escaped}\\b`, 'im').test(sql);
}

export async function auditFreshBaseline(root, baselinePath = 'supabase/fresh/baseline.sql') {
  const blockers = [];
  const migrationDir = resolve(root, 'supabase/migrations');
  const migrations = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  const retirement = await readFile(resolve(migrationDir, RETIREMENT), 'utf8');
  if (!migrations.includes(RETIREMENT) || !retirement.includes(') <> 253')
    || !retirement.includes('order_id is not null) <> 69')
    || !retirement.includes('order_id is null) <> 62')) {
    blockers.push('TEST_RETIREMENT_GUARD_CHANGED_REVIEW_REQUIRED');
  }
  const seed = await readFile(resolve(root, 'supabase/seed.sql'), 'utf8');
  if (!/^\s*select private\.demo_seed\(\);/im.test(seed)) blockers.push('DEMO_SEED_NOT_CURRENT');
  let catalogSeed;
  try { catalogSeed = await readFile(resolve(root, 'supabase/fresh/catalog-seed.sql'), 'utf8'); }
  catch { blockers.push('FRESH_CATALOG_SEED_MISSING'); }
  if (catalogSeed !== undefined) {
    const required = [
      [/insert\s+into\s+public\.workspaces\s*\(kind,\s*name\)[^;]*?\('DEMO',\s*'Demo'\),\s*\('OWNER',\s*'Owner'\)/i, 'FRESH_WORKSPACES_MISSING'],
      [/insert\s+into\s+public\.workspace_branches[^;]*?'DEMO-HQ'/i, 'FRESH_DEMO_BRANCH_MISSING'],
      [/insert\s+into\s+public\.workspace_branches[^;]*?'OWNER-HQ'/i, 'FRESH_OWNER_BRANCH_MISSING'],
      [/insert\s+into\s+private\.guest_ai_budget_policy\s*\(singleton,\s*daily_limit\)\s*values\s*\(true,\s*20\)/i, 'FRESH_GUEST_AI_POLICY_MISSING'],
    ];
    for (const [pattern, code] of required) if (!pattern.test(catalogSeed)) blockers.push(code);
    if (/qobhjvrrpajoyvlgrkbx|insert\s+into\s+(?:auth\.|public\.(?:profiles|workspace_memberships|workspace_orders|workspace_customers|ai_provider_configs))/i.test(catalogSeed)) {
      blockers.push('FRESH_CATALOG_SEED_UNSAFE_DATA');
    }
  }
  let baseline;
  try { baseline = await readFile(resolve(root, baselinePath), 'utf8'); }
  catch { blockers.push('SCHEMA_ONLY_BASELINE_MISSING'); }
  if (baseline !== undefined) {
    // Schema dumps contain DML inside function bodies. Only inspect top-level SQL.
    const topLevel = baseline.replace(/(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1/g, '\n-- function body removed\n');
    if (!/^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?private\s*;/im.test(topLevel)) {
      blockers.push('PRIVATE_SCHEMA_MISSING');
    }
    if (/^\\(?:restrict|unrestrict)\b/m.test(topLevel) ||
        /^\s*create\s+schema\s+public\s*;/im.test(topLevel) ||
        /^\s*set\s+transaction_timeout\s*=/im.test(topLevel) ||
        /^\s*alter\s+default\s+privileges\s+for\s+role\s+supabase_admin\b/im.test(topLevel)) {
      blockers.push('DUMP_COMMAND_REVIEW_REQUIRED');
    }
    for (const object of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
      if (!new RegExp(`^\\s*REVOKE ALL ON ALL ${object} IN SCHEMA public, private FROM PUBLIC, anon, authenticated;`, 'im').test(topLevel)) {
        blockers.push(`MISSING_EXISTING_GRANT_LOCKDOWN:${object}`);
      }
      if (!new RegExp(`^\\s*ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ${object} FROM PUBLIC, anon, authenticated;`, 'im').test(topLevel)) {
        blockers.push(`MISSING_FUTURE_GRANT_LOCKDOWN:${object}`);
      }
    }
    for (const name of REQUIRED_TABLES) {
      if (!statementPresent(topLevel, 'table', `public.${name}`)) blockers.push(`MISSING_TABLE:public.${name}`);
    }
    for (const name of REQUIRED_PRIVATE_TABLES) {
      if (!statementPresent(topLevel, 'table', `private.${name}`)) blockers.push(`MISSING_TABLE:private.${name}`);
    }
    for (const name of REQUIRED_FUNCTIONS) {
      if (!statementPresent(topLevel, 'function', name)) blockers.push(`MISSING_FUNCTION:${name}`);
    }
    for (const name of ['app_role', 'platform_role', 'workspace_kind', 'service_order_status']) {
      if (!statementPresent(topLevel, 'type', `public.${name}`)) blockers.push(`MISSING_TYPE:public.${name}`);
    }
    for (const name of ['profiles', 'workspaces', 'workspace_memberships', 'workspace_orders', 'knowledge_documents']) {
      if (!new RegExp(`^\\s*alter\\s+table(?:\\s+only)?\\s+public\\.${name}\\s+enable\\s+row\\s+level\\s+security\\s*;`, 'im').test(topLevel)) {
        blockers.push(`MISSING_RLS:public.${name}`);
      }
    }
    for (const name of REQUIRED_PRIVATE_TABLES.filter(name => name.startsWith('staff_') || name === 'owner_previews')) {
      if (!new RegExp(`^\\s*alter\\s+table(?:\\s+only)?\\s+private\\.${name}\\s+enable\\s+row\\s+level\\s+security\\s*;`, 'im').test(topLevel)) {
        blockers.push(`MISSING_RLS:private.${name}`);
      }
    }
    for (const [roots, suffix] of [[STAFF_READ_ROOTS, 'staff_readiness'], [PREVIEW_READ_ROOTS, 'owner_preview']]) {
      for (const name of roots) {
        if (!new RegExp(`^\\s*CREATE POLICY ${name}_${suffix} ON public\\.${name} AS RESTRICTIVE FOR SELECT TO authenticated\\b`, 'im').test(topLevel)) {
          blockers.push(`MISSING_RESTRICTIVE_POLICY:${name}_${suffix}`);
        }
      }
    }
    for (const name of LEGACY_TABLES) {
      if (statementPresent(topLevel, 'table', `public.${name}`)) blockers.push(`LEGACY_TABLE_PRESENT:public.${name}`);
    }
    for (const name of LEGACY_PRIVATE_QUOTA_TABLES) {
      if (statementPresent(topLevel, 'table', `private.${name}`)) blockers.push(`LEGACY_TABLE_PRESENT:private.${name}`);
    }
    for (const name of LEGACY_QUOTA_FUNCTIONS) {
      if (statementPresent(topLevel, 'function', name)) blockers.push(`LEGACY_FUNCTION_PRESENT:${name}`);
    }
    for (const name of LEGACY_ANONYMOUS_FUNCTIONS) {
      if (statementPresent(topLevel, 'function', name)) blockers.push(`LEGACY_FUNCTION_PRESENT:${name}`);
    }
    if (/^\s*(?:copy\s+(?:public|private)\.|insert\s+into\s+(?:public|private)\.|update\s+(?:public|private)\.|delete\s+from\s+(?:public|private)\.|truncate\s+(?:public|private)\.)/im.test(topLevel)) {
      blockers.push('POSSIBLE_DATA_STATEMENTS_REVIEW_REQUIRED');
    }
    if (baseline.includes('qobhjvrrpajoyvlgrkbx')) blockers.push('TEST_PROJECT_REF_PRESENT');
  }
  return {
    staticReady: blockers.length === 0,
    historicalMigrationCount: migrations.length,
    historicalEmptyReplayBlockedBy: RETIREMENT,
    baselinePath,
    catalogSeedPath: 'supabase/fresh/catalog-seed.sql',
    blockers,
    liveEmptyProjectReplay: 'NOT_RUN',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length > 2 || (args.length && args[0] !== '--baseline')) {
    console.error('Usage: node scripts/p1-audit-fresh-baseline.mjs [--baseline relative/path.sql]');
    process.exitCode = 2;
  } else {
    auditFreshBaseline(process.cwd(), args[1]).then(result => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.staticReady) process.exitCode = 2;
    }).catch(error => {
      console.error(error instanceof Error ? error.message : 'Baseline audit failed');
      process.exitCode = 2;
    });
  }
}
