import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Discover the Owner workspace through this verified actor's caller-session RLS client. */
export async function readOwnerWorkspaceEntry(actor: ActorContext, client: SupabaseClient): Promise<string | null> {
  if (actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN" || !UUID.test(actor.profileId)) return null;
  const memberships = await client.from("workspace_memberships").select("workspace_id,role")
    .eq("profile_id", actor.profileId).eq("active", true);
  if (memberships.error) throw new Error("Owner workspace membership unavailable");
  const ids = (memberships.data ?? []).filter((row) => UUID.test(row.workspace_id) &&
    ["ADMIN", "MANAGER", "TECHNICIAN"].includes(row.role)).map((row) => row.workspace_id);
  if (!ids.length) return null;
  const workspace = await client.from("workspaces").select("id,kind,active")
    .in("id", ids).eq("kind", "OWNER").eq("active", true).maybeSingle();
  if (workspace.error) throw new Error("Owner workspace unavailable");
  const row = workspace.data;
  return row && row.kind === "OWNER" && row.active === true && ids.includes(row.id) ? row.id : null;
}
