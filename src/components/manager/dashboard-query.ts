import type { QueryClient } from "@tanstack/react-query";
import type { ManagerDashboardPeriod } from "@/domain/manager-dashboard/contracts";

export const managerDashboardQueryKey = (period: ManagerDashboardPeriod) => ["manager-dashboard", period] as const;

/** Limit stale marking to the three KPI period snapshots; never invalidate unrelated application data. */
export function invalidateManagerDashboard(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ["manager-dashboard"] });
}
