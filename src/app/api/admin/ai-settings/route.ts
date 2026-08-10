import { NextResponse } from "next/server";

import { getAISettings } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "./_shared/responses";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getAISettings());
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
