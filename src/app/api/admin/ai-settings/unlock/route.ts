import { NextResponse } from "next/server";
import { z } from "zod";

import { lockAIConfig, unlockAIConfig } from "@/lib/auth/ai-config-unlock";

import { aiSettingsApiError } from "../_shared/responses";

export const runtime = "nodejs";

const unlockSchema = z.object({ password: z.string().min(1).max(512) }).strict();

export async function POST(request: Request) {
  try {
    const { password } = unlockSchema.parse(await request.json());
    await unlockAIConfig(password);
    return NextResponse.json({ unlocked: true });
  } catch (error) {
    return aiSettingsApiError(error);
  }
}

export async function DELETE() {
  await lockAIConfig();
  return new NextResponse(null, { status: 204 });
}
