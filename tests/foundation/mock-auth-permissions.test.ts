import { describe, expect, it } from "vitest";

import { DEMO_IDENTITIES } from "../../src/lib/auth/demo-identities";
import { hasPermission } from "../../src/lib/auth/permissions";

describe("mock identity data boundary", () => {
  it("maps every mock identity to the deterministic seeded profile", () => {
    expect(DEMO_IDENTITIES.map(({ profileId }) => profileId)).toEqual([
      "00000000-0000-4000-8000-000000001001",
      "00000000-0000-4000-8000-000000001002",
      "00000000-0000-4000-8000-000000001003",
      "00000000-0000-4000-8000-000000001004",
      "00000000-0000-4000-8000-000000001005",
      "00000000-0000-4000-8000-000000001006",
    ]);
  });

  it("keeps technician assignment Admin-only", () => {
    expect(hasPermission("ADMIN", "order:assign")).toBe(true);
    expect(hasPermission("MANAGER", "order:assign")).toBe(false);
    expect(hasPermission("TECHNICIAN", "order:assign")).toBe(false);
  });

  it("allows Manager rescheduling without granting generic order updates", () => {
    expect(hasPermission("MANAGER", "order:reschedule")).toBe(true);
    expect(hasPermission("MANAGER", "order:update")).toBe(false);
  });
});
