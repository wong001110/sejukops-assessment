import { describe, expect, it } from "vitest";

import { evaluateWorkflowSupervisorRules } from "@/domain/workflow-supervisor/rules";

describe("Workflow Supervisor deterministic rules", () => {
  it("flags the seeded high-variance completion without inventing a missing-evidence flag", () => {
    expect(
      evaluateWorkflowSupervisorRules({
        quotedPrice: 170,
        extraCharges: 200,
        finalAmount: 370,
        attachmentCount: 1,
      }),
    ).toEqual(["HIGH_AMOUNT_VARIANCE", "UNUSUAL_EXTRA_CHARGE"]);
  });

  it("flags JOB_DONE facts with no evidence", () => {
    expect(
      evaluateWorkflowSupervisorRules({
        quotedPrice: 180,
        extraCharges: 0,
        finalAmount: 180,
        attachmentCount: 0,
      }),
    ).toEqual(["MISSING_EVIDENCE"]);
  });

  it("flags an unusual absolute extra charge below the variance-ratio threshold", () => {
    expect(
      evaluateWorkflowSupervisorRules({
        quotedPrice: 1_000,
        extraCharges: 250,
        finalAmount: 1_250,
        attachmentCount: 2,
      }),
    ).toEqual(["UNUSUAL_EXTRA_CHARGE"]);
  });

  it("keeps the normal evidence-backed control unflagged", () => {
    expect(
      evaluateWorkflowSupervisorRules({
        quotedPrice: 240,
        extraCharges: 20,
        finalAmount: 260,
        attachmentCount: 1,
      }),
    ).toEqual([]);
  });
});
