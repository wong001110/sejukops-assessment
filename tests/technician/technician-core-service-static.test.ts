import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve("src/lib/services/technician-jobs/service.ts"),
  "utf8",
);

describe("Technician job service data scope", () => {
  it("requires both the Technician row and linked profile to remain active", () => {
    expect(service).toContain(
      "profile:profiles!technicians_profile_id_fkey(active,role)",
    );
    expect(service).toContain("linkedProfile?.active !== true");
    expect(service).toContain('linkedProfile.role !== "TECHNICIAN"');
  });

  it("scopes active job list and detail reads to assignment", () => {
    expect(service.match(/\.eq\("assigned_technician_id", technicianId\)/g)?.length).toBe(
      2,
    );
    expect(service.match(/\.in\("status", \["ASSIGNED", "IN_PROGRESS"\]\)/g)?.length).toBe(
      2,
    );
  });

  it("prioritises IN_PROGRESS before ASSIGNED", () => {
    expect(service).toContain('left.status === "IN_PROGRESS" ? 0 : 1');
    expect(service).toContain('right.status === "IN_PROGRESS" ? 0 : 1');
  });

  it("scopes request and notification history to the current profile", () => {
    expect(service.match(/\.eq\("requested_by", identity\.profileId\)/g)?.length).toBe(2);
    expect(service).toContain('.eq("recipient_profile_id", identity.profileId)');
  });
});
