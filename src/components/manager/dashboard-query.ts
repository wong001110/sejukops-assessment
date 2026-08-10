import type { QueryClient } from "@tanstack/react-query";
import type { ManagerDashboardPeriod } from "@/domain/manager-dashboard/contracts";

export const managerDashboardQueryKey = (period: ManagerDashboardPeriod) => ["manager-dashboard", period] as const;

const dashboardInvalidationStorageKey = "sejukops:manager-dashboard-invalidated-at";

/**
 * Limit stale marking to the three KPI period snapshots; never invalidate unrelated application data.
 * The small same-tab marker covers a role switch performed through the demo session POST, which
 * reloads the React tree before a prior in-memory QueryClient can be reused.
 */
export function invalidateManagerDashboard(queryClient: QueryClient) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(dashboardInvalidationStorageKey, String(Date.now()));
  }
  return queryClient.invalidateQueries({ queryKey: ["manager-dashboard"] });
}

export function consumeManagerDashboardInvalidationMarker() {
  if (typeof window === "undefined") return false;
  const hasMarker = Boolean(window.sessionStorage.getItem(dashboardInvalidationStorageKey));
  if (hasMarker) window.sessionStorage.removeItem(dashboardInvalidationStorageKey);
  return hasMarker;
}
