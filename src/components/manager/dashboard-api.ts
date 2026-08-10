import type { ManagerDashboardResponse, ManagerDashboardPeriod } from "@/domain/manager-dashboard/contracts";

type ApiError = { error?: { message?: string }; message?: string };

export async function fetchManagerDashboard(period: ManagerDashboardPeriod): Promise<ManagerDashboardResponse> {
  const response = await fetch(`/api/manager/dashboard?period=${period}`, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({})) as ApiError | ManagerDashboardResponse;
  if (!response.ok) {
    const error = body as ApiError;
    throw new Error(error.error?.message ?? error.message ?? "The dashboard could not be loaded.");
  }
  return body as ManagerDashboardResponse;
}
