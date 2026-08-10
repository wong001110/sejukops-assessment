import { NextResponse } from "next/server";

import { managerReviewListQuerySchema } from "@/domain/manager-review/contracts";
import { listManagerReviews } from "@/lib/services/manager-review/service";

import { managerApiError } from "../_shared/responses";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = managerReviewListQuerySchema.parse({
      branchId: params.get("branchId") || undefined,
      search: params.get("search") || undefined,
    });
    return NextResponse.json(await listManagerReviews(query));
  } catch (error) {
    return managerApiError(error);
  }
}
