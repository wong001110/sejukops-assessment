import "server-only";

import { createPlatformDataContext } from "@/lib/supabase/platform-server";

export class DemoResetError extends Error {
  constructor(
    readonly code: "INVALID_GENERATION" | "RESET_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "DemoResetError";
  }
}

/** The database resolves the only Demo workspace and rechecks this actor. */
export async function resetDemoWorkspace(expectedGeneration: number): Promise<number> {
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1) {
    throw new DemoResetError("INVALID_GENERATION", "Invalid Demo generation");
  }
  const { actor, supabase } = await createPlatformDataContext("ai_config:manage");
  const { data, error } = await supabase.rpc("demo_reset", {
    p_actor_auth_user_id: actor.authUserId,
    p_expected_generation: expectedGeneration,
  });
  if (error || typeof data !== "number" || data !== expectedGeneration + 1) {
    throw new DemoResetError("RESET_FAILED", "Demo reset failed");
  }
  return data;
}
