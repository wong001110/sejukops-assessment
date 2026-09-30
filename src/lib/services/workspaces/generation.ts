import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorkspaceGenerationError extends Error {
  constructor(readonly code: "FORBIDDEN" | "UNAVAILABLE") {
    super(`Workspace generation ${code.toLowerCase()}`);
    this.name = "WorkspaceGenerationError";
  }
}

/** Caller-session read; never use a privileged client to substitute scope. */
export async function readWorkspaceGeneration(
  actor: ActorContext,
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  if (
    !UUID.test(workspaceId) || actor.membership?.workspaceId !== workspaceId ||
    (actor.isAnonymous && actor.membership.kind !== "DEMO")
  ) throw new WorkspaceGenerationError("FORBIDDEN");

  const { data, error } = await supabase.from("workspaces")
    .select("generation").eq("id", workspaceId).single();
  if (error || !Number.isSafeInteger(data?.generation) || data.generation < 1) {
    throw new WorkspaceGenerationError("UNAVAILABLE");
  }
  return data.generation;
}
