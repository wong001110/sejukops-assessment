import { NextResponse } from "next/server";

import { aiOperationsRequestSchema } from "@/domain/ai-operations/contracts";
import { runAIOperations } from "@/lib/ai/runtime/operations-orchestrator";

import { aiOperationsApiError } from "./responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = aiOperationsRequestSchema.parse(await request.json());
    return NextResponse.json(await runAIOperations(input));
  } catch (error) {
    return aiOperationsApiError(error);
  }
}
