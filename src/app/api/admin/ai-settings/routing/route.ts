import { NextResponse } from "next/server";

import { updateAIRoutingSchema } from "@/domain/ai-config/contracts";
import { assertAIConfigAdmin } from "@/lib/auth/ai-config-admin";
import { updateAIRouting } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../_shared/responses";
import { aiSettingsMutationError } from "../_shared/request-guard";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const rejected = aiSettingsMutationError(request);
  if (rejected) return rejected;
  try {
    await assertAIConfigAdmin();
    const input = updateAIRoutingSchema.parse(await request.json());
    return NextResponse.json(await updateAIRouting(input));
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
