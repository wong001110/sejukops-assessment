import { NextResponse } from "next/server";
import { z } from "zod";

import { updateAIProviderSchema } from "@/domain/ai-config/contracts";
import { assertAIConfigAdmin } from "@/lib/auth/ai-config-admin";
import {
  deleteAIProvider,
  updateAIProvider,
} from "@/lib/services/ai-config/service";

import { aiSettingsApiError } from "../../_shared/responses";
import { aiSettingsMutationError } from "../../_shared/request-guard";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

async function providerId(context: RouteContext): Promise<string> {
  return z.string().uuid().parse((await context.params).id);
}

export async function PATCH(request: Request, context: RouteContext) {
  const rejected = aiSettingsMutationError(request);
  if (rejected) return rejected;
  try {
    await assertAIConfigAdmin();
    const id = await providerId(context);
    const input = updateAIProviderSchema.parse(await request.json());
    return NextResponse.json({ provider: await updateAIProvider(id, input) });
  } catch (error) {
    return aiSettingsApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const rejected = aiSettingsMutationError(request, false);
  if (rejected) return rejected;
  try {
    await assertAIConfigAdmin();
    await deleteAIProvider(await providerId(context));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return aiSettingsApiError(error);
  }
}
