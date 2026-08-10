import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100004_technician_completion.sql"),
  "utf8",
);

describe("Technician completion migration", () => {
  it("keeps the evidence bucket private and PostgreSQL metadata authoritative", () => {
    expect(migration).toContain("create table public.service_evidence_uploads");
    expect(migration).toContain("alter table public.service_evidence_uploads enable row level security");
    expect(migration).toContain("set public = false");
    expect(migration).not.toContain("create policy service_evidence_uploads");
  });

  it("exposes four service-role-only transaction RPCs", () => {
    expect(migration.match(/security definer/g)).toHaveLength(4);
    expect(migration.match(/from public, anon, authenticated;/g)).toHaveLength(4);
    expect(migration.match(/to service_role;/g)).toHaveLength(4);
    expect(migration.match(/INVALID_TECHNICIAN_ACTOR/g)).toHaveLength(4);
  });

  it("enforces count, MIME-specific, and combined byte limits while reserving", () => {
    expect(migration).toContain("v_active_count >= 6");
    expect(migration).toContain("v_active_bytes + p_size_bytes > 125829120");
    expect(migration).toContain("then 12582912");
    expect(migration).toContain("then 78643200");
    expect(migration).toContain("then 15728640");
  });

  it("confirms actual object metadata before making an upload authoritative", () => {
    expect(migration).toContain("p_actual_mime_type");
    expect(migration).toContain("p_actual_size_bytes");
    expect(migration).toContain("STORAGE_METADATA_MISMATCH");
    expect(migration).toContain("set status = 'UPLOADED', uploaded_at = now()");
  });

  it("allows a failed individual item to retry without discarding successful uploads", () => {
    expect(migration).toContain("v_upload_status not in ('FAILED', 'ORPHANED')");
    expect(migration).toContain(
      "set status = 'RESERVED', failure_code = null, uploaded_at = null",
    );
  });

  it("atomically creates report, canonical attachments, payment, transition, and audit", () => {
    expect(migration).toContain("insert into public.service_reports");
    expect(migration).toContain("insert into public.service_attachments");
    expect(migration).toMatch(
      /where u\.order_id = p_order_id\s+and u\.technician_id = v_technician_id\s+and u\.status = 'UPLOADED'/,
    );
    expect(migration).toContain("set status = 'ATTACHED', service_attachment_id = u.id");
    expect(migration).toContain("insert into public.payments");
    expect(migration).toContain("update public.orders set status = 'JOB_DONE'");
    expect(migration).toContain("'JOB_COMPLETED'");
  });

  it("serializes confirmation, deletion, and completion through the order lock", () => {
    expect(migration.match(/from public\.orders o[^;]*for update;/gs)?.length).toBeGreaterThanOrEqual(
      4,
    );
    const markFunction = migration.slice(
      migration.indexOf("function public.technician_mark_evidence_upload"),
      migration.indexOf("function public.technician_complete_job"),
    );
    expect(markFunction.indexOf("from public.orders o")).toBeLessThan(
      markFunction.indexOf("from public.service_evidence_uploads u"),
    );
    expect(migration).toContain("u.status in ('RESERVED', 'DELETING')");
  });

  it("revalidates assignment and IN_PROGRESS before every reservation replay", () => {
    const reserveFunction = migration.slice(
      migration.indexOf("function public.technician_reserve_evidence_upload"),
      migration.indexOf("function public.technician_confirm_evidence_upload"),
    );
    const orderLock = reserveFunction.indexOf("from public.orders o");
    const replayLookup = reserveFunction.indexOf("where u.upload_request_key = p_request_key");
    const replayReturn = reserveFunction.indexOf("return query select v_upload_id");
    expect(orderLock).toBeGreaterThan(0);
    expect(orderLock).toBeLessThan(replayLookup);
    expect(reserveFunction.indexOf("v_assigned_technician_id is distinct")).toBeLessThan(
      replayReturn,
    );
    expect(reserveFunction.indexOf("v_order_status <> 'IN_PROGRESS'")).toBeLessThan(
      replayReturn,
    );
  });

  it("excludes and identifies stale prior-Technician staging rows", () => {
    expect(migration).toContain("failure_code = 'TECHNICIAN_REASSIGNED'");
    expect(migration).toContain("u.technician_id <> v_technician_id");
    expect(migration.match(/u\.technician_id = v_technician_id/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it("uses DB-authoritative final amount and retry-safe payload signatures", () => {
    expect(migration).toContain("completion_payload_signature");
    expect(migration).toContain("'job:complete:' || p_request_key::text");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("IDEMPOTENCY_KEY_CONFLICT");
    expect(migration).not.toContain("final_amount,");
    expect(migration).toContain("v_quoted_price + p_extra_charges > 9999999999.99");
    expect(migration).toContain("INVALID_FINAL_AMOUNT");
  });

  it("does not introduce Phase 4 or 5 side effects", () => {
    expect(migration).not.toContain("WHATSAPP");
    expect(migration).not.toContain("ai_flags");
    expect(migration).not.toContain("dashboard");
  });
});
