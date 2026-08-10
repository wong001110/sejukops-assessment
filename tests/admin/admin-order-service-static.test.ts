import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve("src/lib/services/admin-orders/service.ts"),
  "utf8",
);

describe("Admin order reference-data boundaries", () => {
  it("excludes Technicians whose linked profile is inactive from form options", () => {
    expect(service).toContain(
      "profile:profiles!technicians_profile_id_fkey(display_name,active)",
    );
    expect(service).toContain("profile.active !== true");
    expect(service).toContain("mapTechnician(technician, true)");
  });
});
