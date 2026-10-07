import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("supabase/migrations/20261001062950_staff_auth_foundation.sql"), "utf8").replaceAll("\r\n", "\n");
const baseline = readFileSync(resolve("supabase/fresh/baseline.sql"), "utf8");
const proofSql = readFileSync(resolve("supabase/migrations/20261001065703_staff_password_proof.sql"), "utf8");

function definition(source: string, name: string): string {
  const start = source.search(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\(`, "i"));
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const remainder = source.slice(start);
  const delimiter = remainder.match(/\bas (\$[a-z_]*\$)/i)?.[1];
  expect(delimiter, `${name} has a complete SQL body`).toBeTruthy();
  const bodyStart = remainder.indexOf(delimiter!) + delimiter!.length;
  const bodyEnd = remainder.indexOf(delimiter!, bodyStart);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return remainder.slice(0, bodyEnd + delimiter!.length + 1).replaceAll("\r\n", "\n");
}
function body(source: string, name: string): string {
  const functionSource = definition(source, name);
  const delimiter = functionSource.match(/\bas (\$[a-z_]*\$)/i)![1];
  const start = functionSource.indexOf(delimiter) + delimiter.length;
  return functionSource.slice(start, functionSource.lastIndexOf(delimiter)).trim();
}

// These are source-level contracts, not PostgreSQL execution/RLS proof.
describe("staff auth migration static contracts", () => {
  it("adds an intersecting readiness fence to every business read root", () => {
    const tables = ["workspaces", "workspace_memberships", "workspace_branches", "workspace_customers",
      "workspace_technicians", "workspace_orders", "workspace_assignment_proposals", "knowledge_documents",
      "knowledge_versions", "knowledge_chunks", "knowledge_version_pages"];
    for (const table of tables) {
      expect(sql).toContain(`create policy ${table}_staff_readiness on public.${table}\n  as restrictive for select to authenticated\n  using (private.staff_current_actor_ready(${table === "workspaces" ? "id" : "workspace_id"}));`);
    }
    expect(sql.match(/as restrictive for select to authenticated/g)).toHaveLength(tables.length);
    expect(sql).not.toMatch(/grant\s+(?:all|insert|update|delete).*\bto\s+(?:anon|authenticated)\b/i);
  });

  it("keeps every guarded business body synchronized with the current fresh baseline", () => {
    const guards: Record<string, string> = {
      "private.knowledge_editor": "perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());",
      "private.workspace_order_admin_profile": "perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());",
      "private.workspace_order_manual_actor": "perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());",
      "private.workspace_order_manager_reschedule": "perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());",
      "private.workspace_order_technician_transition": "perform private.staff_require_actor((select auth.uid()), p_workspace_id, private.staff_signed_session_id());",
      "private.workspace_assignment_proposal_create_mcp": "perform private.staff_require_actor(p_initiator_auth_user_id, p_workspace_id, null);",
      "private.workspace_assignment_proposal_insert": "perform private.staff_require_actor(\n    (select p.auth_user_id from public.profiles p where p.id = p_initiator_profile_id),\n    p_workspace_id, case when (select auth.uid()) =\n      (select p.auth_user_id from public.profiles p where p.id = p_initiator_profile_id)\n      then private.staff_signed_session_id() else null end);",
    };
    for (const [name, guard] of Object.entries(guards)) {
      const actual = definition(sql, name);
      expect(actual).toContain(`\nbegin\n  ${guard}\n`);
      expect(body(sql, name)).toBe(body(baseline, name));
    }
  });

  it("replaces service signatures without leaving an old proof-free overload", () => {
    const functions = [
      { name: "workspace_assignment_proposal_approve", old: "uuid,uuid,uuid", next: "uuid,uuid,uuid,uuid", actor: "p_approver_auth_user_id" },
      { name: "knowledge_issue_pdf_attestation", old: "uuid,uuid,bigint,uuid,text[]", next: "uuid,uuid,bigint,uuid,text[],uuid", actor: "p_actor_auth_user_id" },
    ];
    for (const item of functions) {
      for (const schema of ["private", "public"]) {
        expect(sql).toContain(`drop function ${schema}.${item.name}(${item.old});`);
        expect(definition(sql, `${schema}.${item.name}`)).toContain("p_actor_session_id uuid DEFAULT NULL");
        expect(sql).toContain(`revoke all on function ${schema}.${item.name}(${item.next}) from public, anon, authenticated;`);
        expect(sql).toContain(`grant execute on function ${schema}.${item.name}(${item.next}) to service_role;`);
      }
      expect(definition(sql, `private.${item.name}`)).toContain(`perform private.staff_require_actor(${item.actor}, p_workspace_id, p_actor_session_id);`);
      expect(body(sql, `private.${item.name}`)).toBe(body(baseline, `private.${item.name}`));
    }
  });

  it("uses signed live sessions and current private state, with stable write authority locks", () => {
    const ready = definition(sql, "private.staff_actor_ready");
    expect(ready).toContain("if v_staff.profile_id is null then return true; end if;");
    expect(ready).toContain("v_profile.id is null or not v_profile.active");
    expect(ready).toContain("v_staff.password_change_required and not p_allow_password_pending");
    expect(ready).toContain("m.profile_id = v_profile.id and m.workspace_id = v_staff.workspace_id and m.active for share");
    expect(ready).toContain("s.id = p_session_id and s.user_id = p_auth_user_id");
    expect(ready).toContain("s.created_at > v_staff.sessions_valid_after");
    expect(ready).toContain("s.not_after > clock_timestamp()");
    expect(ready).toContain("u.is_anonymous is false and w.active and w.kind = 'OWNER'");
    expect(ready).toContain("where auth_user_id = p_auth_user_id for share");
    expect(ready).toContain("where profile_id = v_profile.id for share");
    expect(definition(sql, "private.staff_signed_session_id")).toContain("auth.jwt()->>'session_id'");
    expect(sql).not.toMatch(/(?:insert into|update|delete from)\s+auth\./i);
    expect(definition(sql, "private.staff_require_actor")).toContain("p_session_id, true, false");
  });

  it("exposes only self onboarding status and leaves private state inaccessible to authenticated", () => {
    const status = definition(sql, "public.staff_session_status");
    expect(status).toContain("v_auth_user_id uuid := (select auth.uid())");
    expect(status).toContain("where auth_user_id = v_auth_user_id");
    for (const key of ["isManaged", "passwordChangeRequired", "sessionAllowed", "authRevision", "sessionId"]) {
      expect(status).toContain(`'${key}'`);
    }
    expect(status).not.toContain("'email'");
    expect(sql).toContain("revoke all on private.staff_accounts, private.staff_provisioning from public, anon, authenticated;");
    expect(sql).toContain("alter table private.staff_accounts enable row level security;");
    expect(sql).toContain("alter table private.staff_provisioning enable row level security;");
  });

  it("keeps credential material out of the strict provisioning input and pins managed identity", () => {
    expect(definition(sql, "private.staff_input_valid")).toContain("(p_input - array['name','email','role','branchCode']) = '{}'::jsonb");
    expect(sql).toContain("check (private.staff_input_valid(input, email))");
    const guard = definition(sql, "private.staff_identity_guard");
    expect(guard).toContain("v_profile.platform_role <> 'USER' or v_profile.demo_principal");
    expect(guard).toContain("new.auth_user_id is distinct from v_staff.auth_user_id");
    expect(guard).toContain("new.workspace_id <> v_staff.workspace_id");
    expect(guard).toContain("m.profile_id = new.profile_id and m.workspace_id <> new.workspace_id");
  });
});

describe("password proof migration static interface contracts", () => {
  it("keeps derived credential sentinels and claim rows out of caller interfaces", () => {
    expect(proofSql).toContain("revoke all on private.staff_password_claims from public,anon,authenticated,service_role;");
    expect(proofSql).toContain("revoke all on function private.staff_auth_password_fingerprint(uuid) from public,anon,authenticated,service_role;");
    const issue = definition(proofSql, "public.staff_issue_password_claim");
    expect(issue).toContain("return jsonb_build_object('claimId',v_claim.id,'expiresAt',v_claim.expires_at);");
    const status = definition(proofSql, "public.staff_session_status");
    expect(status).not.toMatch(/'[^']*fingerprint[^']*'\s*,/i);
    const summary = definition(proofSql, "private.staff_account_summary");
    expect(summary).not.toMatch(/'[^']*fingerprint[^']*'\s*,/i);
    expect(summary).toContain("private.staff_password_current(s.profile_id)");
  });

  it("requires the opaque claim in the sole service completion signature", () => {
    expect(proofSql).toContain("drop function public.staff_complete_password_change(uuid,uuid,uuid);");
    expect(proofSql).toContain("revoke all on function public.staff_complete_password_change(uuid,uuid,uuid,uuid) from public,anon,authenticated;");
    const complete = definition(proofSql, "public.staff_complete_password_change");
    expect(complete).toContain("v_claim.profile_id<>v_profile_id or v_claim.auth_user_id<>p_auth_user_id");
    expect(complete).toContain("v_fingerprint<>v_claim.auth_password_fingerprint");
    expect(complete).toContain("p_actor_session_id=v_claim.original_session_id");
    expect(complete).toContain("s.created_at>=v_claim.created_at");
    expect(complete).toContain("v_claim.consumed_at is not null");
    expect(complete).toContain("v_claim.expires_at<=clock_timestamp()");
  });
});
