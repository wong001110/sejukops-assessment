import { NextResponse } from "next/server";

import { createAIProviderSchema } from "@/domain/ai-config/contracts";
import { assertAIConfigUnlocked } from "@/lib/auth/ai-config-unlock";
import { createAIProvider } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../_shared/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await assertAIConfigUnlocked();
    const input = createAIProviderSchema.parse(await request.json());
    return NextResponse.json(
      { provider: await createAIProvider(input) },
      { status: 201 },
    );
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
