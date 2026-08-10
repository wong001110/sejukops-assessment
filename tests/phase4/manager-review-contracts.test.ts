import { describe, expect, it } from "vitest";

import {
  managerReviewDecisionSchema,
  whatsappOpenSchema,
} from "@/domain/manager-review/contracts";

const requestKey = "00000000-0000-4000-8000-000000009001";

describe("Phase 4 public contracts", () => {
  it("requires a traceable note for clarification but not approval", () => {
    expect(
      managerReviewDecisionSchema.safeParse({
        decision: "REQUEST_CLARIFICATION",
        note: "  ",
        requestKey,
      }).success,
    ).toBe(false);
    expect(
      managerReviewDecisionSchema.parse({ decision: "APPROVE", requestKey }),
    ).toEqual({ decision: "APPROVE", requestKey });
  });

  it("requires idempotency keys for user-click WhatsApp actions", () => {
    expect(whatsappOpenSchema.safeParse({ requestKey: "retry" }).success).toBe(false);
    expect(whatsappOpenSchema.parse({ requestKey })).toEqual({ requestKey });
  });
});
