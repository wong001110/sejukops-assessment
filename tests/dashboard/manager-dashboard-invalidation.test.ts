import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { consumeManagerDashboardInvalidationMarker, invalidateManagerDashboard } from "@/components/manager/dashboard-query";

describe("Manager dashboard KPI invalidation", () => {
  it("marks only the dashboard query family stale and carries one same-tab marker across a role reload", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const entries = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) } });

    await invalidateManagerDashboard({ invalidateQueries } as never);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["manager-dashboard"] });
    expect(consumeManagerDashboardInvalidationMarker()).toBe(true);
    expect(consumeManagerDashboardInvalidationMarker()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("calls the shared invalidator only after successful KPI-changing writes", () => {
    const technician = readFileSync(resolve("src/components/technician/job-workspace.tsx"), "utf8");
    const admin = readFileSync(resolve("src/components/admin/order-workspace.tsx"), "utf8");
    const manager = readFileSync(resolve("src/components/manager/review-workspace.tsx"), "utf8");

    expect(technician).toContain("await technicianCompletionApi.complete");
    expect(technician).toContain("await invalidateManagerDashboard(queryClient)");
    expect(technician.indexOf("await technicianCompletionApi.complete")).toBeLessThan(technician.indexOf("await invalidateManagerDashboard(queryClient)"));
    expect(admin).toContain("await orderApi.reschedule");
    expect(admin).toContain("await invalidateManagerDashboard(queryClient); rescheduleRequestKey");
    expect(admin).toContain('if (decision === "APPROVE") await invalidateManagerDashboard(queryClient)');
    expect(manager).toContain('if (input.decision === "REQUEST_CLARIFICATION") await invalidateManagerDashboard(queryClient)');
    expect(manager).toContain('if (result.request.status === "APPROVED") await invalidateManagerDashboard(queryClient)');
  });

  it("uses one application-level QueryClient instead of isolated portal caches", () => {
    const rootLayout = readFileSync(resolve("src/app/layout.tsx"), "utf8");
    const managerLayout = readFileSync(resolve("src/app/manager/layout.tsx"), "utf8");
    const dashboard = readFileSync(resolve("src/components/manager/dashboard-workspace.tsx"), "utf8");

    expect(rootLayout).toContain("<AppQueryProvider>{children}</AppQueryProvider>");
    expect(managerLayout).not.toContain("ManagerQueryProvider");
    expect(dashboard).toContain("consumeManagerDashboardInvalidationMarker()");
  });
});
