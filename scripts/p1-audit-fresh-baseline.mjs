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
];
export const REQUIRED_FUNCTIONS = [
  'private.demo_seed', 'private.demo_seed_knowledge', 'private.demo_reset', 'public.demo_seed',
  'private.guest_ai_budget_reserve', 'public.guest_ai_budget_reserve',
  'public.workspace_order_create', 'public.knowledge_search_keyword',
];
export const LEGACY_TABLES = [
  'branches', 'technicians', 'customers', 'orders', 'service_reports',
  'service_attachments', 'payments', 'job_reviews', 'notifications',
  'internal_notifications', 'ai_flags', 'document_imports',
  'document_import_extraction_requests',
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
  let baseline;
  try { baseline = await readFile(resolve(root, baselinePath), 'utf8'); }
  catch { blockers.push('SCHEMA_ONLY_BASELINE_MISSING'); }
  if (baseline !== undefined) {
    // Schema dumps contain DML inside function bodies. Only inspect top-level SQL.
    const topLevel = baseline.replace(/(\$[a-zA-Z0-9_]*\$)[\s\S]*?\1/g, '\n-- function body removed\n');
    if (!/^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?private\s*;/im.test(topLevel)) {
      blockers.push('PRIVATE_SCHEMA_MISSING');
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
    for (const name of LEGACY_TABLES) {
      if (statementPresent(topLevel, 'table', `public.${name}`)) blockers.push(`LEGACY_TABLE_PRESENT:public.${name}`);
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
