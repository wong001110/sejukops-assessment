import { NextResponse } from "next/server";

import { updateAIRoutingSchema } from "@/domain/ai-config/contracts";
import { updateAIRouting } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../_shared/responses";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const input = updateAIRoutingSchema.parse(await request.json());
    return NextResponse.json(await updateAIRouting(input));
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
