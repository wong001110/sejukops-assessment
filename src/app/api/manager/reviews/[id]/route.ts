import { NextResponse } from "next/server";
import { z } from "zod";

import { getManagerReviewDetailWithSupportingDocument } from "@/lib/services/manager-review/detail-with-supporting-document";

import { managerApiError } from "../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    return NextResponse.json(await getManagerReviewDetailWithSupportingDocument(id));
  } catch (error) {
    return managerApiError(error);
  }
}
