import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100002_admin_order_workflow.sql"),
  "utf8",
);

describe("Admin order workflow migration", () => {
  it("keeps each multi-table mutation inside a privileged transaction RPC", () => {
    expect(migration).toContain("function public.admin_create_order");
    expect(migration).toContain("function public.admin_direct_reschedule_order");
    expect(migration).toContain("function public.admin_resolve_reschedule_request");
    expect(migration.match(/security definer/g)).toHaveLength(3);
    expect(migration.match(/to service_role;/g)).toHaveLength(3);
    expect(migration.match(/from public, anon, authenticated;/g)).toHaveLength(4);
  });

  it("serializes idempotency keys and rejects changed replay payloads", () => {
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(3);
    expect(migration.match(/payloadSignature/g)?.length).toBeGreaterThanOrEqual(6);
    expect(migration.match(/IDEMPOTENCY_KEY_CONFLICT/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("creates assignment and reschedule audits plus duplicate-safe notifications", () => {
    expect(migration).toContain("'ORDER_CREATED'");
    expect(migration).toContain("'TECHNICIAN_ASSIGNED'");
    expect(migration).toContain("'ORDER_RESCHEDULED'");
    expect(migration.match(/on conflict \(recipient_profile_id, business_key\) do nothing/g)).toHaveLength(2);
  });

  it("preserves the Technician request reason on the executed event", () => {
    expect(migration).toContain("v_request_reason text;");
    expect(migration).toMatch(
      /v_previous_schedule,\r?\n\s+v_effective_schedule,\r?\n\s+v_request_reason,/,
    );
    expect(migration).toContain("'resolutionNote', nullif(btrim(p_resolution_note), '')");
  });

  it("rejects a request without inserting an executed reschedule", () => {
    const rejectionBranch = migration.match(
      /else\r?\n\s+update public\.order_reschedule_requests[\s\S]*?RESCHEDULE_REQUEST_REJECTED[\s\S]*?end if;/,
    )?.[0] ?? "";
    expect(rejectionBranch).toContain("status = 'REJECTED'");
    expect(rejectionBranch).not.toContain("insert into public.order_reschedules");
  });
});
