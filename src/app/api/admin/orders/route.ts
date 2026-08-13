import { NextRequest, NextResponse } from "next/server";

import { adminOrderListQuerySchema, createAdminOrderSchema } from "@/domain/admin-orders/contracts";
import { createAdminOrder } from "@/lib/services/admin-orders/service";
import { listAdminOrdersPaged } from "@/lib/services/admin-orders/listing";
import { adminApiError } from "../_shared/responses";

export async function GET(request: NextRequest) {
  try {
    const parameters = request.nextUrl.searchParams;
    const query = adminOrderListQuerySchema.parse({
      search: parameters.get("search") || undefined,
      status: parameters.get("status") || undefined,
      branchId: parameters.get("branchId") || undefined,
      technicianId: parameters.get("technicianId") || undefined,
      page: parameters.get("page") || undefined,
      pageSize: parameters.get("pageSize") || undefined,
    });
    return NextResponse.json(await listAdminOrdersPaged(query));
  } catch (error) {
    return adminApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = createAdminOrderSchema.parse(await request.json());
    return NextResponse.json(await createAdminOrder(input), { status: 201 });
  } catch (error) {
    return adminApiError(error);
  }
}
