import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100003_technician_core.sql"),
  "utf8",
);

describe("Technician core migration", () => {
  it("exposes only service-role transactional RPCs", () => {
    expect(migration).toContain("function public.technician_start_job");
    expect(migration).toContain("function public.technician_request_reschedule");
    expect(migration.match(/security definer/g)).toHaveLength(2);
    expect(migration.match(/from public, anon, authenticated;/g)).toHaveLength(2);
    expect(migration.match(/to service_role;/g)).toHaveLength(2);
  });

  it("enforces actor, assignment, and lifecycle state in both mutations", () => {
    expect(migration.match(/INVALID_TECHNICIAN_ACTOR/g)).toHaveLength(2);
    expect(migration.match(/JOB_NOT_ASSIGNED/g)).toHaveLength(2);
    expect(migration).toContain("v_status <> 'ASSIGNED'");
    expect(migration).toContain("v_status not in ('ASSIGNED', 'IN_PROGRESS')");
  });

  it("atomically starts the job once with an idempotent audit", () => {
    expect(migration).toContain("update public.orders set status = 'IN_PROGRESS'");
    expect(migration).toContain("'JOB_STARTED'");
    expect(migration).toContain("'job:start:' || p_request_key::text");
  });

  it("serializes exact replays and rejects changed payloads", () => {
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(migration.match(/payloadSignature/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/IDEMPOTENCY_KEY_CONFLICT/g)).toHaveLength(2);
  });

  it("creates one pending request and duplicate-safe office notifications", () => {
    expect(migration).toContain("RESCHEDULE_REASON_REQUIRED");
    expect(migration).toContain("'PENDING'");
    expect(migration).toContain("p.role in ('ADMIN', 'MANAGER') and p.active");
    expect(migration).toContain(
      "on conflict (recipient_profile_id, business_key) do nothing",
    );
    expect(migration).toContain("'RESCHEDULE_REQUESTED'");
  });

  it("never exposes a Technician direct schedule mutation", () => {
    expect(migration).not.toContain("set scheduled_at");
    expect(migration).not.toContain("insert into public.order_reschedules");
  });
});
