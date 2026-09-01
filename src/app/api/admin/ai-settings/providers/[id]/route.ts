import { NextResponse } from "next/server";
import { z } from "zod";

import { updateAIProviderSchema } from "@/domain/ai-config/contracts";
import { assertAIConfigUnlocked } from "@/lib/auth/ai-config-unlock";
import {
  deleteAIProvider,
  updateAIProvider,
} from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../../_shared/responses";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

async function providerId(context: RouteContext): Promise<string> {
  return z.string().uuid().parse((await context.params).id);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await assertAIConfigUnlocked();
    const id = await providerId(context);
    const input = updateAIProviderSchema.parse(await request.json());
    return NextResponse.json({ provider: await updateAIProvider(id, input) });
  } catch (error) {
    return aiSettingsApiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await assertAIConfigUnlocked();
    await deleteAIProvider(await providerId(context));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
