import { describe, expect, it } from "vitest";

import {
  TECHNICIAN_EVIDENCE_POLICY,
  completeTechnicianJobSchema,
  reserveEvidenceUploadSchema,
} from "../../src/domain/technician-completion/contracts";

const requestKey = "9953e846-6ad8-48c2-a60e-081bbc4d9061";

describe("Technician completion contracts", () => {
  it("exports the authoritative evidence policy", () => {
    expect(TECHNICIAN_EVIDENCE_POLICY.bucket).toBe("service-evidence");
    expect(TECHNICIAN_EVIDENCE_POLICY.maximumFileCount).toBe(6);
    expect(TECHNICIAN_EVIDENCE_POLICY.maximumTotalBytes).toBe(120 * 1024 * 1024);
    expect(TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes["image/jpeg"]).toBe(
      12 * 1024 * 1024,
    );
    expect(TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes["video/mp4"]).toBe(
      75 * 1024 * 1024,
    );
    expect(TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes["application/pdf"]).toBe(
      15 * 1024 * 1024,
    );
  });

  it("accepts each file at its exact MIME-specific boundary", () => {
    const cases = Object.entries(TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes);
    for (const [mimeType, sizeBytes] of cases) {
      expect(
        reserveEvidenceUploadSchema.safeParse({
          originalFilename: "evidence.file",
          mimeType,
          sizeBytes,
          requestKey,
        }).success,
      ).toBe(true);
      expect(
        reserveEvidenceUploadSchema.safeParse({
          originalFilename: "evidence.file",
          mimeType,
          sizeBytes: sizeBytes + 1,
          requestKey,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unsupported MIME types and invalid request keys", () => {
    expect(
      reserveEvidenceUploadSchema.safeParse({
        originalFilename: "evidence.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 100,
        requestKey: "retry",
      }).success,
    ).toBe(false);
  });

  it("accepts decimal-safe 0.29 amounts and rejects third decimal places", () => {
    expect(
      completeTechnicianJobSchema.safeParse({
        workDone: "Cleaned the indoor unit and tested cooling.",
        extraCharges: 0.29,
        payment: { amount: 0.29, method: "EWALLET" },
        requestKey,
      }).success,
    ).toBe(true);
    expect(
      completeTechnicianJobSchema.safeParse({
        workDone: "Cleaned the indoor unit and tested cooling.",
        extraCharges: 0.291,
        requestKey,
      }).success,
    ).toBe(false);
  });

  it("requires work done and a complete optional payment shape", () => {
    expect(
      completeTechnicianJobSchema.safeParse({
        workDone: " ",
        extraCharges: 0,
        requestKey,
      }).success,
    ).toBe(false);
    expect(
      completeTechnicianJobSchema.safeParse({
        workDone: "Replaced the capacitor.",
        extraCharges: 10,
        payment: { amount: 10 },
        requestKey,
      }).success,
    ).toBe(false);
  });
});
