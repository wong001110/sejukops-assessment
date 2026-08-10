import { NextResponse } from "next/server";
import { z } from "zod";

import { testSavedAIProviderSchema } from "@/domain/ai-config/contracts";
import { testSavedAIProvider } from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../../../_shared/responses";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const id = z.string().uuid().parse((await context.params).id);
    const body = await request.text();
    const input = testSavedAIProviderSchema.parse(body ? JSON.parse(body) : {});
    return NextResponse.json(await testSavedAIProvider(id, input));
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
