import { NextResponse } from "next/server";

import { managerReviewListQuerySchema } from "@/domain/manager-review/contracts";
import { listManagerReviewsPaged } from "@/lib/services/manager-review/listing";
import { managerApiError } from "../_shared/responses";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = managerReviewListQuerySchema.parse({
      branchId: params.get("branchId") || undefined,
      search: params.get("search") || undefined,
      page: params.get("page") || undefined,
      pageSize: params.get("pageSize") || undefined,
    });
    return NextResponse.json(await listManagerReviewsPaged(query));
  } catch (error) {
    return managerApiError(error);
  }
}
