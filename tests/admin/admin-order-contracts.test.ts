import { describe, expect, it } from "vitest";

import {
  createAdminOrderSchema,
  directRescheduleSchema,
  resolveRescheduleRequestSchema,
} from "../../src/domain/admin-orders/contracts";

const requestKey = "c1f4f087-0177-44d4-a709-1f089b1f4207";

describe("Admin order request contracts", () => {
  it("accepts the complete create-and-assign request", () => {
    const result = createAdminOrderSchema.parse({
      customer: {
        name: "Assessment Customer",
        phone: "+60 00 000 0900",
        address: "90 Jalan Fiksyen, Kuala Lumpur",
      },
      branchId: "00000000-0000-4000-8000-000000000101",
      technicianId: "00000000-0000-4000-8000-000000002003",
      scheduledAt: "2026-08-11T01:00:00.000Z",
      problemDescription: "Living room air conditioner is not cooling.",
      serviceType: "Repair",
      quotedPrice: 240.5,
      adminNotes: "Call before arrival.",
      requestKey,
    });

    expect(result.quotedPrice).toBe(240.5);
    expect(result.requestKey).toBe(requestKey);
  });

  it("requires a UUID request key and all customer/service fields", () => {
    const result = createAdminOrderSchema.safeParse({
      customer: { name: "", phone: "123", address: "" },
      branchId: "not-a-uuid",
      problemDescription: "",
      serviceType: "",
      quotedPrice: -1,
      requestKey: "retry-me",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.branchId).toBeDefined();
      expect(fields.problemDescription).toBeDefined();
      expect(fields.requestKey).toBeDefined();
    }
  });

  it("limits money to two decimal places", () => {
    const result = createAdminOrderSchema.safeParse({
      customer: {
        name: "Assessment Customer",
        phone: "+600000000900",
        address: "90 Jalan Fiksyen",
      },
      branchId: "00000000-0000-4000-8000-000000000101",
      problemDescription: "Noisy fan",
      serviceType: "Repair",
      quotedPrice: 10.999,
      requestKey,
    });
    expect(result.success).toBe(false);
  });

  it("requires offset-aware timestamps for direct rescheduling", () => {
    expect(
      directRescheduleSchema.safeParse({
        scheduledAt: "2026-08-12 09:00",
        requestKey,
      }).success,
    ).toBe(false);
    expect(
      directRescheduleSchema.safeParse({
        scheduledAt: "2026-08-12T09:00:00+08:00",
        requestKey,
      }).success,
    ).toBe(true);
  });

  it("prevents a rejected request from carrying an executed schedule", () => {
    expect(
      resolveRescheduleRequestSchema.safeParse({
        decision: "REJECT",
        newSchedule: "2026-08-12T09:00:00+08:00",
        requestKey,
      }).success,
    ).toBe(false);
  });
});
