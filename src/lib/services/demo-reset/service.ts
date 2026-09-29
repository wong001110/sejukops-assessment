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

export type DemoResetStatus = Readonly<{ generation: number; orderCount: number }>;

/** Read the current Demo generation only after resolving a platform actor. */
export async function readDemoResetStatus(): Promise<DemoResetStatus> {
  const { supabase } = await createPlatformDataContext("ai_config:view");
  const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
    .select("id,generation").eq("kind", "DEMO").eq("active", true).single();
  if (workspaceError || !workspace || !Number.isSafeInteger(workspace.generation)
      || workspace.generation < 1) {
    throw new DemoResetError("RESET_FAILED", "Demo status unavailable");
  }
  const { count, error: countError } = await supabase.from("workspace_orders")
    .select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id);
  if (countError || !Number.isSafeInteger(count) || count === null || count < 0) {
    throw new DemoResetError("RESET_FAILED", "Demo status unavailable");
  }
  return { generation: workspace.generation, orderCount: count };
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
