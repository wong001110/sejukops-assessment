import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100005_payment_receipt.sql"),
  "utf8",
);

function sqlFunction(name: string, nextName: string) {
  return migration.slice(
    migration.indexOf(`function public.${name}`),
    migration.indexOf(`function public.${nextName}`),
  );
}

describe("Technician private payment receipt migration", () => {
  it("keeps one current image receipt private and DB-authoritative", () => {
    expect(migration).toContain("create table public.payment_receipt_uploads");
    expect(migration).toContain("storage_bucket = 'service-evidence'");
    expect(migration).toContain("mime_type in ('image/jpeg', 'image/png', 'image/webp')");
    expect(migration).toContain("size_bytes <= 12582912");
    expect(migration).toContain("payment_receipt_one_current_idx");
    expect(migration).toContain(
      "alter table public.payment_receipt_uploads enable row level security",
    );
    expect(migration).not.toContain("create policy payment_receipt_uploads");
  });

  it("revalidates active assignment and IN_PROGRESS before reservation replay", () => {
    const reserve = sqlFunction(
      "technician_reserve_payment_receipt",
      "technician_confirm_payment_receipt",
    );
    const orderLock = reserve.indexOf("from public.orders o");
    const replayLookup = reserve.indexOf("where r.upload_request_key = p_request_key");
    const replayReturn = reserve.indexOf("return query select v_receipt_id");
    expect(orderLock).toBeGreaterThan(0);
    expect(orderLock).toBeLessThan(replayLookup);
    expect(reserve.indexOf("p.role = 'TECHNICIAN' and p.active and t.active")).toBeLessThan(
      replayReturn,
    );
    expect(reserve.indexOf("v_assigned_technician_id is distinct")).toBeLessThan(
      replayReturn,
    );
    expect(reserve.indexOf("v_order_status <> 'IN_PROGRESS'")).toBeLessThan(
      replayReturn,
    );
  });

  it("confirms actual image metadata and technician scope before upload state", () => {
    const confirm = sqlFunction(
      "technician_confirm_payment_receipt",
      "technician_mark_payment_receipt",
    );
    expect(confirm).toContain("p_actual_mime_type");
    expect(confirm).toContain("p_actual_size_bytes");
    expect(confirm).toContain("STORAGE_METADATA_MISMATCH");
    expect(confirm).toContain("v_receipt.technician_id <> v_technician_id");
    expect(confirm).toContain("set status = 'UPLOADED', uploaded_at = now()");
  });

  it("atomically binds only a selected uploaded receipt to an existing payment", () => {
    const completion = sqlFunction(
      "technician_complete_job_with_receipt",
      "technician_mark_reassigned_evidence_cleaned",
    );
    expect(completion).toContain("'receiptUploadId', p_receipt_upload_id");
    expect(completion).toContain("completion_receipt_payload_signature");
    expect(completion).toContain("RECEIPT_REQUIRES_PAYMENT");
    expect(completion).toContain("RECEIPT_SELECTION_REQUIRED");
    expect(completion).toContain("v_receipt.status <> 'UPLOADED'");
    expect(completion).toContain("set receipt_storage_path = v_receipt.storage_path");
    expect(completion).toContain("set status = 'ATTACHED', payment_id = v_base.payment_id");
    expect(completion).toContain("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("excludes stale prior-Technician uploads and supplies bounded cleanup acknowledgements", () => {
    expect(migration).toContain("failure_code = 'TECHNICIAN_REASSIGNED'");
    expect(migration).toContain("r.technician_id <> (");
    expect(migration).toContain("technician_mark_reassigned_evidence_cleaned");
    expect(migration).toContain("technician_mark_reassigned_receipt_cleaned");
    expect(migration).toContain("status = 'ORPHANED' and failure_code = 'TECHNICIAN_REASSIGNED'");
  });

  it("removes direct service-role access to the receipt-unaware completion RPC", () => {
    expect(migration).toMatch(
      /revoke execute on function public\.technician_complete_job\([\s\S]*?\) from service_role;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.technician_complete_job_with_receipt\([\s\S]*?\) to service_role;/,
    );
  });
});
