import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  fileURLToPath(new URL(
    "../../src/lib/services/manager-dashboard/service.ts",
    import.meta.url,
  )),
  "utf8",
);
const route = readFileSync(
  fileURLToPath(new URL(
    "../../src/app/api/manager/dashboard/route.ts",
    import.meta.url,
  )),
  "utf8",
);

describe("Manager dashboard server boundary", () => {
  it("requires dashboard permission, Manager role, and compact RPC validation", () => {
    expect(service).toContain('createAuthorizedDataContext("dashboard:view")');
    expect(service).toContain('context.identity.role !== "MANAGER"');
    expect(service).toContain('.rpc("manager_dashboard_metrics"');
    expect(service).toContain("managerDashboardResponseSchema.safeParse(data)");
    expect(service).not.toContain(".from(\"orders\")");
    expect(service).not.toContain(".from(\"service_reports\")");
  });

  it("does not expose the deterministic as-of clock to browser input", () => {
    expect(service).not.toContain("p_as_of:");
    expect(route).not.toContain("asOf");
    expect(route).not.toContain("as_of");
  });

  it("defaults a missing period to This Week and rejects custom ranges", () => {
    expect(route).toContain('?? "this_week"');
    expect(route).toContain("managerDashboardPeriodSchema.parse");
    expect(route).not.toContain("startDate");
    expect(route).not.toContain("endDate");
  });
});

