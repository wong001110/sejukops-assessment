import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100006_completion_review.sql"),
  "utf8",
);
const seed = readFileSync(resolve("supabase/seed.sql"), "utf8");

describe("Phase 4 completion-review migration", () => {
  it("keeps public transaction entry points service-role-only", () => {
    expect(migration.match(/security definer/g)).toHaveLength(7);
    expect(migration.match(/from public, anon, authenticated;/g)).toHaveLength(6);
    expect(migration.match(/to service_role;/g)).toHaveLength(6);
    expect(migration).toContain("from public, anon, authenticated, service_role;");
    expect(migration).toContain(
      "grant execute on function public.technician_complete_job_with_receipt",
    );
  });

  it("prepares at most one truthful READY/OPENED completion notification", () => {
    expect(migration).toContain("'completion:' || v_report_id::text");
    expect(migration).toContain(
      "on conflict on constraint notifications_order_id_channel_business_key_key",
    );
    expect(migration).toContain("'WHATSAPP'");
    expect(migration).toContain("'READY'");
    expect(migration).toContain("set status = 'OPENED'");
    expect(migration).toContain("NOTIFICATION_NOT_CURRENT");
    expect(migration).toContain("sr.completion_revision::text");
    expect(migration).not.toMatch(/'SENT'|'DELIVERED'|'READ'/);
  });

  it("validates a normalized recipient before inserting READY", () => {
    const prepare = migration.slice(
      migration.indexOf("function public.prepare_completion_whatsapp"),
      migration.indexOf("function public.open_completion_whatsapp"),
    );
    expect(prepare).toContain("v_normalized_recipient");
    expect(prepare).toContain("INVALID_WHATSAPP_RECIPIENT");
    expect(prepare.indexOf("INVALID_WHATSAPP_RECIPIENT")).toBeLessThan(
      prepare.indexOf("insert into public.notifications"),
    );
    expect(prepare).toContain("v_normalized_recipient, v_message, 'READY'");
  });

  it("authorizes active actors and Technician assignment at the database boundary", () => {
    expect(migration).toContain("p.id = p_actor_profile_id and p.active");
    expect(migration).toContain("v_assigned_technician_id is distinct from v_actor_technician_id");
    expect(migration).toContain("p.role = 'MANAGER' and p.active");
  });

  it("supports exact replay and rejects changed review/open/reschedule payloads", () => {
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(5);
    expect(migration.match(/IDEMPOTENCY_KEY_CONFLICT/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("v_existing_signature is distinct from v_payload_signature");
    expect(migration).toContain("return query select v_existing_order_id, v_existing_review_id");
  });

  it("supports clarification-aware re-completion and revision notifications", () => {
    expect(migration).toContain("completion_revision integer not null default 1");
    expect(migration).toContain("v_current_revision := v_current_revision + 1");
    expect(migration).toContain("v_latest_review_decision is distinct from 'CLARIFICATION_REQUESTED'");
    expect(migration).toContain("completion_receipt_payload_signature = null");
    expect(migration).toContain("COMPLETION_REVISION_SUPERSEDED");
    expect(migration).toContain("':revision:' || v_completion_revision::text");
    expect(migration).toContain("'completionRevision', v_current_revision");
    expect(migration).toContain("failure_code = 'SUPERSEDED_BY_CLARIFICATION'");
  });

  it("converges deterministic seed notifications on revision-aware identity", () => {
    expect(seed).toContain("'completion:' || sr.id::text || ':revision:'");
    expect(seed).toContain("has been completed by Technician");
    expect(migration).toContain("n.business_key = 'CUSTOMER_JOB_COMPLETED'");
    expect(migration).toContain("delete from public.notifications");
  });

  it("atomically closes approvals and reopens clarification with a visible note", () => {
    expect(migration).toContain("set status = 'REVIEWED'");
    expect(migration).toContain("set status = 'CLOSED'");
    expect(migration).toContain("set status = 'IN_PROGRESS'");
    expect(migration).toContain("'JOB_REVIEWED'");
    expect(migration).toContain("'JOB_CLOSED'");
    expect(migration).toContain("'JOB_CLARIFICATION_REQUESTED'");
    expect(migration).toContain("'Manager note: ' || btrim(p_note)");
    expect(migration).toContain("nullif(btrim(p_note), ''), clock_timestamp()");
    expect(migration).toContain("where r.order_id = p_order_id and r.status = 'ATTACHED'");
    expect(migration).toContain("CLARIFICATION_NOTE_REQUIRED");
  });

  it("preserves lifecycle status while Manager reschedules with MYT same-day storage", () => {
    const managerReschedule = migration.slice(
      migration.indexOf("function public.manager_direct_reschedule_order"),
      migration.indexOf("function public.manager_resolve_reschedule_request"),
    );
    expect(managerReschedule).toContain("'DIRECT_MANAGER'");
    expect(managerReschedule).toContain("update public.orders set scheduled_at");
    expect(managerReschedule).not.toContain("set status =");
    expect(migration).toContain("'TECHNICIAN_REQUEST'");
    expect(migration).toContain("on conflict (recipient_profile_id, business_key) do nothing");
  });
});
