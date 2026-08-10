import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100012_workflow_supervisor.sql"),
  "utf8",
);
const seed = readFileSync(resolve("supabase/seed.sql"), "utf8");

describe("Workflow Supervisor migration", () => {
  it("defines explicit deterministic thresholds and all initial rules", () => {
    expect(migration).toContain("amount_variance_ratio numeric(8, 4) not null default 0.50");
    expect(migration).toContain("amount_variance_minimum numeric(12, 2) not null default 100");
    expect(migration).toContain("unusual_extra_charge_ratio numeric(8, 4) not null default 1.00");
    expect(migration).toContain("unusual_extra_charge_minimum numeric(12, 2) not null default 250");
    expect(migration).toContain("'HIGH_AMOUNT_VARIANCE'");
    expect(migration).toContain("'MISSING_EVIDENCE'");
    expect(migration).toContain("'UNUSUAL_EXTRA_CHARGE'");
  });

  it("runs atomically on JOB_DONE without any provider dependency", () => {
    expect(migration).toContain("after update of status on public.orders");
    expect(migration).toContain("new.status = 'JOB_DONE'");
    const generator = migration.slice(
      migration.indexOf("create or replace function public.workflow_supervisor_generate_flags"),
      migration.indexOf("create or replace function public.workflow_supervisor_on_job_done"),
    );
    expect(generator).toContain("public.service_attachments");
    expect(generator).not.toContain("ai_provider_configs");
    expect(generator).not.toContain("WORKFLOW_EXPLANATION");
  });

  it("is duplicate-safe per completion revision and supersedes older open flags", () => {
    expect(migration).toContain("unique (order_id, completion_revision, rule_code)");
    expect(migration).toContain("on conflict (order_id, completion_revision, rule_code) do update set");
    expect(migration).toContain("details = excluded.details");
    expect(migration).toContain("completion_revision < v_revision");
    expect(migration).toContain("status = 'RESOLVED'");
    expect(seed).toContain("on conflict (order_id, completion_revision, rule_code) do update");
    expect(seed).toMatch(/000000004030',1,\s*'HIGH_AMOUNT_VARIANCE'/);
    expect(seed).toMatch(/000000004033',1,\s*'MISSING_EVIDENCE'/);
    expect(seed).toMatch(/000000004030',1,\s*'UNUSUAL_EXTRA_CHARGE'/);
  });

  it("keeps explanation RPCs service-role-only and validates active Managers", () => {
    expect(migration).toMatch(/p\.role = 'MANAGER' and p\.active/g);
    expect(migration).toContain(
      "revoke all on function public.manager_begin_workflow_flag_explanation",
    );
    expect(migration).toContain(
      "grant execute on function public.manager_begin_workflow_flag_explanation(uuid, uuid, uuid) to service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.manager_begin_workflow_flag_explanation(uuid, uuid, uuid) to authenticated",
    );
  });

  it("persists exact idempotent outcomes and audits bounded explanation state only", () => {
    expect(migration).toContain("workflow_flag_explanation_requests");
    expect(migration).toContain("'action', 'REPLAY'");
    expect(migration).toContain("'action', 'CACHED'");
    expect(migration).toContain("WORKFLOW_FLAG_EXPLANATION_AVAILABLE");
    expect(migration).toContain("WORKFLOW_FLAG_EXPLANATION_UNAVAILABLE");
    expect(migration).not.toContain("update public.orders set status");
  });

  it("leases one active provider attempt per flag and safely recovers stale work", () => {
    expect(migration).toContain("workflow_flag_one_pending_explanation_idx");
    expect(migration).toContain("where status = 'PENDING'");
    expect(migration).toContain("where id = p_flag_id for update");
    expect(migration).toContain("lease_expires_at > v_now");
    expect(migration).toContain("lease_expires_at = v_now + interval '5 minutes'");
    expect(migration).toContain("explanation_error_code = 'AI_TIMEOUT'");
    expect(migration).toContain("'staleRequestKey', v_request.request_key");
    expect(migration).toContain("Match the begin RPC lock order (flag, then request)");
  });
});
