import { NextResponse } from "next/server";

import { createAIProviderSchema } from "@/domain/ai-config/contracts";
import { assertAIConfigAdmin } from "@/lib/auth/ai-config-admin";
import { createAIProvider } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../_shared/responses";
import { aiSettingsMutationError } from "../_shared/request-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejected = aiSettingsMutationError(request);
  if (rejected) return rejected;
  try {
    await assertAIConfigAdmin();
    const input = createAIProviderSchema.parse(await request.json());
    return NextResponse.json(
      { provider: await createAIProvider(input) },
      { status: 201 },
    );
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
