import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve("src/components/manager/dashboard-workspace.tsx"), "utf8");
const query = readFileSync(resolve("src/components/manager/dashboard-query.ts"), "utf8");
const review = readFileSync(resolve("src/components/manager/review-workspace.tsx"), "utf8");
const shell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");

describe("Manager KPI dashboard UI", () => {
  it("uses the fixed, week-default periods with separately cached TanStack query keys", () => {
    expect(workspace).toContain('useState<ManagerDashboardPeriod>("this_week")');
    expect(workspace).toContain('{ label: "Today", value: "today" }');
    expect(workspace).toContain('{ label: "This Week", value: "this_week" }');
    expect(workspace).toContain('{ label: "This Month", value: "this_month" }');
    expect(workspace).toContain("managerDashboardQueryKey(period)");
    expect(workspace).toContain("staleTime: 60_000");
    expect(workspace).toContain("placeholderData: keepPreviousData");
    expect(query).toContain('["manager-dashboard", period]');
  });

  it("renders deterministic KPI, comparison, period-aware trend, leaderboard, and distribution states", () => {
    expect(workspace).toContain('title="Jobs completed"');
    expect(workspace).toContain('title="Total amount"');
    expect(workspace).toContain('title="Rescheduled"');
    expect(workspace).toContain('title="Average job value"');
    expect(workspace).toContain("comparisonLabel");
    expect(workspace).toContain("Hourly completed jobs");
    expect(workspace).toContain("Daily completed jobs");
    expect(workspace).toContain("Weekly completed jobs");
    expect(workspace).toContain("Technician leaderboard");
    expect(workspace).toContain("Service distribution");
    expect(workspace).toContain("No completed jobs for");
  });

  it("keeps first-load, refetch, error, zero, and reduced-motion behavior understandable", () => {
    expect(workspace).toContain("<DashboardLoading />");
    expect(workspace).toContain("Dashboard unavailable");
    expect(workspace).toContain("Latest dashboard refresh failed");
    expect(workspace).toContain("Updating {periodNames[period]} metrics");
    expect(workspace).toContain('aria-busy={query.isFetching}');
    const css = readFileSync(resolve("src/styles/globals.css"), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".dashboard-stat-grid");
    expect(css).toContain(".desktop-shell .desktop-header { height: auto");
    expect(css).toContain("padding-left: 42px");
  });

  it("makes the route discoverable and invalidates only KPI cache after aggregate-changing Manager actions", () => {
    expect(shell).toContain('key: "/manager/dashboard"');
    expect(query).toContain('invalidateQueries({ queryKey: ["manager-dashboard"] })');
    expect(review).toContain("if (input.decision === \"REQUEST_CLARIFICATION\") await invalidateManagerDashboard(queryClient)");
    expect(review).toContain("await invalidateManagerDashboard(queryClient)");
    expect(review).toContain('if (result.request.status === "APPROVED") await invalidateManagerDashboard(queryClient)');
  });
});
