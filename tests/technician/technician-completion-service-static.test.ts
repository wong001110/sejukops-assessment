import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve("src/lib/services/technician-completion/service.ts"),
  "utf8",
);

describe("Technician completion service boundaries", () => {
  it("uses signed private upload and view URLs without proxying file bytes", () => {
    expect(service).toContain("createSignedUploadUrl");
    expect(service).toContain("createSignedUrl");
    expect(service).not.toContain("request.formData()");
  });

  it("uses Storage listing only to confirm an actual reserved object", () => {
    expect(service.match(/\.list\(folder/g)).toHaveLength(1);
    expect(service).toContain('from("service_evidence_uploads")');
    expect(service).toContain("normalizeStorageObjectMetadata(metadata)");
  });

  it("releases a hidden reservation when signed authorization fails", () => {
    const signedFailure = service.match(
      /if \(storageError \|\| !authorization\) \{[\s\S]*?\n  \}/,
    )?.[0] ?? "";
    expect(signedFailure).toContain("markEvidence");
    expect(signedFailure).toContain('"FAILED"');
    expect(signedFailure).toContain('"SIGNED_UPLOAD_AUTHORIZATION_FAILED"');
    expect(signedFailure).toContain("reservation could not be released");
    expect(signedFailure).toContain("same request key");
  });

  it("only signs after the scoped reservation RPC authorizes current state", () => {
    const reserve = service.slice(
      service.indexOf("async function reserveTechnicianEvidence"),
      service.indexOf("async function inspectActualStorageObject"),
    );
    expect(reserve.indexOf('rpc(\n    "technician_reserve_evidence_upload"')).toBeLessThan(
      reserve.indexOf("createSignedUploadUrl"),
    );
  });

  it("re-reads state before cleanup after an ambiguous confirmation RPC", () => {
    const confirmationFailure = service.match(
      /if \(error\) \{\r?\n    let refreshed[\s\S]*?throwDataError\(error\);\r?\n  \}/,
    )?.[0] ?? "";
    expect(confirmationFailure).toContain("getEvidenceRecord");
    expect(confirmationFailure).toContain('["UPLOADED", "ATTACHED"]');
    expect(confirmationFailure).toContain('text(refreshed.status) === "RESERVED"');
    expect(confirmationFailure).toContain("cleanupEvidenceObject");
  });

  it("attempts cleanup and records FAILED or ORPHANED outcomes", () => {
    expect(service).toContain("const targetStatus = cleanupError ? \"ORPHANED\" : \"FAILED\"");
    expect(service).toContain('"METADATA_FINALIZATION_FAILED"');
    expect(service).toContain('"STORAGE_METADATA_MISMATCH"');
  });

  it("marks deletion in progress before removing the private object", () => {
    const deletion = service.slice(service.indexOf("async function deleteTechnicianEvidence"));
    expect(deletion.indexOf('markEvidence(context, orderId, evidenceId, "DELETING"')).toBeLessThan(
      deletion.indexOf(".remove([text(evidence.storage_path)])"),
    );
    expect(deletion.lastIndexOf('markEvidence(context, orderId, evidenceId, "DELETED"')).toBeGreaterThan(
      deletion.indexOf(".remove([text(evidence.storage_path)])"),
    );
  });

  it("requires active linked Technician profile before privileged data access", () => {
    expect(service).toContain("profile:profiles!technicians_profile_id_fkey(active,role)");
    expect(service).toContain("profile?.active !== true");
    expect(service).toContain('profile.role !== "TECHNICIAN"');
  });

  it("requires the dedicated payment permission when payment is recorded", () => {
    expect(service).toContain('requirePermission(context.identity.role, "payment:record")');
    expect(service).toContain('message.includes("INVALID_FINAL_AMOUNT")');
  });

  it("uses the receipt-aware transaction and returns a private signed receipt", () => {
    expect(service).toContain('"technician_complete_job_with_receipt"');
    expect(service).toContain("p_receipt_upload_id: input.payment?.receiptUploadId ?? null");
    expect(service).toContain('from("payment_receipt_uploads")');
    expect(service).toContain("receipt = mapReceipt");
  });

  it("releases failed receipt authorization and rereads ambiguous confirmation", () => {
    const reserve = service.slice(
      service.indexOf("function reserveTechnicianPaymentReceipt"),
      service.indexOf("function confirmTechnicianPaymentReceipt"),
    );
    expect(reserve).toContain("createSignedUploadUrl");
    expect(reserve).toContain('"SIGNED_UPLOAD_AUTHORIZATION_FAILED"');
    expect(reserve).toContain('"FAILED"');
    const confirm = service.slice(
      service.indexOf("function confirmTechnicianPaymentReceipt"),
      service.indexOf("function getTechnicianPaymentReceipt"),
    );
    expect(confirm).toContain("inspectActualStorageObject");
    expect(confirm).toContain("getReceiptRecord");
    expect(confirm).toContain('text(refreshed.status) === "RESERVED"');
    expect(confirm).toContain("cleanupReceiptObject");
  });

  it("best-effort cleans identifiable prior-Technician objects after completion", () => {
    expect(service).toContain("cleanupReassignedUploadObjects");
    expect(service).toContain('eq("failure_code", "TECHNICIAN_REASSIGNED")');
    expect(service).toContain("technician_mark_reassigned_evidence_cleaned");
    expect(service).toContain("technician_mark_reassigned_receipt_cleaned");
  });
});
