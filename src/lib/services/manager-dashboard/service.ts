import "server-only";

import type {
  ManagerDashboardPeriod,
  ManagerDashboardResponse,
} from "@/domain/manager-dashboard/contracts";
import { managerDashboardResponseSchema } from "@/domain/manager-dashboard/contracts";
import { ManagerDashboardError } from "@/domain/manager-dashboard/errors";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

type RpcError = Readonly<{ message: string; code?: string }>;

function throwDashboardDataError(error: RpcError): never {
  if (error.message.includes("INVALID_MANAGER_ACTOR")) {
    throw new ManagerDashboardError(
      "MANAGER_DASHBOARD_PERMISSION_DENIED",
      "An active Manager session is required.",
      403,
      { cause: error },
    );
  }
  throw new ManagerDashboardError(
    "MANAGER_DASHBOARD_DATA_ACCESS_FAILED",
    "Dashboard metrics are temporarily unavailable.",
    503,
    { cause: error },
  );
}

export async function getManagerDashboard(
  period: ManagerDashboardPeriod,
): Promise<ManagerDashboardResponse> {
  const context = await createAuthorizedDataContext("dashboard:view");
  if (context.identity.role !== "MANAGER") {
    throw new ManagerDashboardError(
      "MANAGER_DASHBOARD_PERMISSION_DENIED",
      "This dashboard is available to Manager users only.",
      403,
    );
  }

  // Deliberately omit p_as_of. Production always evaluates against database now();
  // the optional RPC parameter exists only for deterministic verification.
  const { data, error } = await context.supabase.rpc("manager_dashboard_metrics", {
    p_actor_profile_id: context.identity.profileId,
    p_period: period,
  });
  if (error) throwDashboardDataError(error);

  const parsed = managerDashboardResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ManagerDashboardError(
      "MANAGER_DASHBOARD_DATA_ACCESS_FAILED",
      "Dashboard metrics returned an invalid data contract.",
      503,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
