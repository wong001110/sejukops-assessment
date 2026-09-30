import "server-only";

import { AIConfigError, AI_ERROR_MESSAGES } from "@/domain/ai-config/errors";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";

/** Recheck the current server-resolved platform identity before parsing a secret-bearing request. */
export async function assertAIConfigAdmin(): Promise<void> {
  const actor = await getServerActorContext();
  if (!actor || !hasActorPermission(actor, "ai_config:manage")) {
    throw new AIConfigError(
      "AI_CONFIG_PERMISSION_DENIED",
      AI_ERROR_MESSAGES.AI_CONFIG_PERMISSION_DENIED,
      403,
    );
  }
}
