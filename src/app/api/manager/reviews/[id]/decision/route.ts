import { NextResponse } from "next/server";
import { z } from "zod";

import { managerReviewDecisionSchema } from "@/domain/manager-review/contracts";
import { reviewManagerJob } from "@/lib/services/manager-review/service";

import { managerApiError } from "../../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = managerReviewDecisionSchema.parse(await request.json());
    return NextResponse.json(await reviewManagerJob(id, input));
  } catch (error) {
    return managerApiError(error);
  }
}
