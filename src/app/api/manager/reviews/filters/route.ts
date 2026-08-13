import { NextResponse } from "next/server";

import { managerReviewFilterQuerySchema } from "@/domain/manager-review/contracts";
import { getManagerReviewFilterData } from "@/lib/services/manager-review/listing";
import { managerApiError } from "../../_shared/responses";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = managerReviewFilterQuerySchema.parse({
      q: params.get("q") || undefined,
      selectedId: params.get("selectedId") || undefined,
    });
    return NextResponse.json(await getManagerReviewFilterData(query));
  } catch (error) {
    return managerApiError(error);
  }
}
