import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608100013_document_understanding.sql",
  "utf8",
);

describe("Document Understanding migration", () => {
  it("keeps uploaded sources private and metadata-authoritative", () => {
    expect(sql).toContain("'documents', 'documents', false");
    expect(sql).toContain("alter table public.document_imports enable row level security");
    expect(sql).toContain("grant select, insert, update on table public.document_imports to service_role");
    expect(sql).toContain("DOCUMENT_MIME_NOT_ALLOWED");
    expect(sql).toContain("STORAGE_METADATA_MISMATCH");
  });

  it("has a durable request ledger for lost-response and old-key exact replay", () => {
    expect(sql).toContain("create table if not exists public.document_import_extraction_requests");
    expect(sql).toContain("request_key uuid primary key");
    expect(sql).toContain("if v_request.status = 'SUCCEEDED'");
    expect(sql).toContain("if v_request.status = 'FAILED'");
    expect(sql).toContain("v_request.document_import_id <> p_document_import_id");
    expect(sql).toContain("v_request.payload_signature is distinct from v_signature");
  });

  it("recovers only stale PENDING leases and protects active attempts", () => {
    expect(sql).toContain("lease_expires_at > clock_timestamp()");
    expect(sql).toContain("interval '2 minutes'");
    expect(sql).toContain("set status = 'FAILED', failure_code = 'AI_TIMEOUT'");
    expect(sql).toContain("DOCUMENT_EXTRACTION_IN_PROGRESS");
  });

  it("writes operational data only inside explicit atomic CREATE confirmation", () => {
    const beforeConfirmation = sql.slice(
      0,
      sql.indexOf("create or replace function public.admin_confirm_document_import_create"),
    );
    expect(beforeConfirmation).not.toContain("public.admin_create_order(");
    expect(beforeConfirmation).not.toContain("insert into public.audit_logs");
    expect(sql).toContain("from public.admin_create_order(");
    expect(sql).toContain("'action', 'CREATE'");
  });

  it("persists and exactly replays the original customer reuse outcome", () => {
    expect(sql).toContain("confirmation_customer_reused boolean");
    expect(sql).toContain("v_import.confirmation_customer_reused");
    expect(sql).toContain("confirmation_customer_reused = v_customer_reused");
  });

  it("restricts all mutation RPCs to service_role", () => {
    for (const functionName of [
      "admin_reserve_document_import",
      "admin_confirm_document_source",
      "admin_begin_document_extraction",
      "admin_finish_document_extraction",
      "admin_fail_document_extraction",
      "admin_confirm_document_import_create",
    ]) {
      expect(sql).toContain(`revoke all on function public.${functionName}`);
      expect(sql).toContain(`grant execute on function public.${functionName}`);
    }
  });
});
