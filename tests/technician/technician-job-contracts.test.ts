import { describe, expect, it } from "vitest";

import {
  createTechnicianRescheduleRequestSchema,
  startTechnicianJobSchema,
  type TechnicianJobListItem,
} from "../../src/domain/technician-jobs/contracts";
import { hasPermission } from "../../src/lib/auth/permissions";

const requestKey = "b47aa269-ecbd-4f04-ad53-426609fe744c";

describe("Technician core contracts", () => {
  it("requires a retry-stable UUID to start a job", () => {
    expect(startTechnicianJobSchema.parse({ requestKey })).toEqual({ requestKey });
    expect(startTechnicianJobSchema.safeParse({ requestKey: "start-once" }).success).toBe(
      false,
    );
  });

  it("requires a nonblank reschedule reason", () => {
    expect(
      createTechnicianRescheduleRequestSchema.safeParse({ reason: "  ", requestKey }).success,
    ).toBe(false);
    expect(
      createTechnicianRescheduleRequestSchema.parse({
        reason: "Customer is unavailable at the scheduled time",
        requestedSchedule: "2026-08-13T10:00:00+08:00",
        requestKey,
      }).reason,
    ).toBe("Customer is unavailable at the scheduled time");
  });

  it("rejects schedule strings without an explicit timezone offset", () => {
    expect(
      createTechnicianRescheduleRequestSchema.safeParse({
        reason: "Customer requested a later visit",
        requestedSchedule: "2026-08-13 10:00",
        requestKey,
      }).success,
    ).toBe(false);
  });

  it("gives Technician a request permission without direct reschedule permission", () => {
    expect(hasPermission("TECHNICIAN", "job:request_reschedule")).toBe(true);
    expect(hasPermission("TECHNICIAN", "order:reschedule")).toBe(false);
  });

  it("narrows list items to active job states", () => {
    const status: TechnicianJobListItem["status"] = "IN_PROGRESS";
    expect(status).toBe("IN_PROGRESS");
  });
});
