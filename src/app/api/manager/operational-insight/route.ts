import { NextResponse } from "next/server";

import { operationalInsightRequestSchema } from "@/domain/ai-operations/contracts";
import { getOperationalInsight } from "@/lib/services/ai-operations/operational-insight";

import { aiOperationsApiError } from "../ai-operations/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = operationalInsightRequestSchema.parse(await request.json());
    return NextResponse.json(await getOperationalInsight(input));
  } catch (error) {
    return aiOperationsApiError(error);
  }
}
