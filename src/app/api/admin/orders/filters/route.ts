import { NextRequest, NextResponse } from "next/server";

import { adminOrderFilterQuerySchema } from "@/domain/admin-orders/contracts";
import { getAdminOrderFilterData } from "@/lib/services/admin-orders/listing";
import { adminApiError } from "../../_shared/responses";

export async function GET(request: NextRequest) {
  try {
    const parameters = request.nextUrl.searchParams;
    const query = adminOrderFilterQuerySchema.parse({
      kind: parameters.get("kind"),
      q: parameters.get("q") || undefined,
      search: parameters.get("search") || undefined,
      branchId: parameters.get("branchId") || undefined,
      technicianId: parameters.get("technicianId") || undefined,
      selectedId: parameters.get("selectedId") || undefined,
    });
    return NextResponse.json(await getAdminOrderFilterData(query));
  } catch (error) {
    return adminApiError(error);
  }
}
