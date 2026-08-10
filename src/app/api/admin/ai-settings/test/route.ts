import { NextResponse } from "next/server";

import { testUnsavedAIProviderSchema } from "@/domain/ai-config/contracts";
import { testUnsavedAIProvider } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../_shared/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = testUnsavedAIProviderSchema.parse(await request.json());
    return NextResponse.json(await testUnsavedAIProvider(input));
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
