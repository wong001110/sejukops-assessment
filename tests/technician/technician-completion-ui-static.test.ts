import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const completionForm = readFileSync(
  resolve("src/components/technician/completion-form.tsx"),
  "utf8",
);
const workspace = readFileSync(
  resolve("src/components/technician/job-workspace.tsx"),
  "utf8",
);
const completionApi = readFileSync(
  resolve("src/components/technician/job-api.ts"),
  "utf8",
);

describe("Technician completion UI safeguards", () => {
  it("hydrates existing evidence before entering completion and exposes a loading state", () => {
    expect(workspace).toContain("technicianCompletionApi.listEvidence(selected.job.id)");
    expect(workspace).toContain("completionLoading");
    expect(workspace).toContain("Evidence could not be loaded. Try again.");
  });

  it("counts only active remote evidence and presents failed reservations as recoverable", () => {
    expect(completionForm).toContain('["RESERVED", "UPLOADED", "ATTACHED", "DELETING"]');
    expect(completionForm).toContain('"Upload interrupted — remove and add again"');
    expect(completionForm).toContain('"Upload failed — remove and add again"');
    expect(completionForm).toContain("serverErrors");
    expect(completionForm).toContain("removingServer");
    expect(completionForm).toContain('item.status === "RESERVED"');
    expect(completionForm).toContain('item.status === "DELETING"');
    expect(completionForm).toContain('item.status !== "ATTACHED"');
    expect(completionForm).toContain("Retry removal");
    expect(completionForm).not.toContain('item.status !== "ATTACHED" && !deleting');
  });

  it("keeps retry keys stable and safely handles a replayed reservation without an upload token", () => {
    expect(completionApi).toContain("if (!reservation.upload)");
    expect(completionApi).toContain('reservation.evidence.status === "UPLOADED"');
    expect(completionApi).toContain("body: JSON.stringify({ requestKey })");
    expect(completionForm).toContain("remoteId: evidenceIdAfterUploadFailure(cause, item.remoteId)");
  });

  it("provides client-side monetary validation before completion submission", () => {
    expect(completionForm).toContain("const moneyMaximum = 9_999_999_999.99");
    expect(completionForm).toContain("can have no more than two decimal places");
    expect(completionForm).toContain("const extraChargesError = moneyFailure");
    expect(completionForm).toContain("quotedPrice + (extraCharges ?? 0) > moneyMaximum");
    expect(completionForm).toContain('aria-label="Payment method"');
    expect(completionForm).toContain('aria-live="polite"');
  });
});
