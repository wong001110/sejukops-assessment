import { NextResponse } from "next/server";

import { managerDashboardPeriodSchema } from "@/domain/manager-dashboard/contracts";
import { getManagerDashboard } from "@/lib/services/manager-dashboard/service";

import { managerApiError } from "../_shared/responses";

export async function GET(request: Request) {
  try {
    const period = managerDashboardPeriodSchema.parse(
      new URL(request.url).searchParams.get("period") ?? "this_week",
    );
    return NextResponse.json(await getManagerDashboard(period));
  } catch (error) {
    return managerApiError(error);
  }
}

