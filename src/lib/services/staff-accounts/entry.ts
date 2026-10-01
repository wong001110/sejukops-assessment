import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "@/lib/auth/actor-policy";

/** The live caller RLS establishes the one active staff workspace. */
export async function readStaffWorkspaceEntry(actor: ActorContext, client: SupabaseClient): Promise<string | null> {
  if (actor.isAnonymous || actor.platformRole !== "USER" || !actor.staff || actor.businessReady !== true) return null;
  const members = await client.from("workspace_memberships").select("workspace_id,role")
    .eq("profile_id", actor.profileId).eq("active", true);
  if (members.error) throw new Error("Staff workspace is unavailable");
  if (!members.data || members.data.length !== 1) return null;
  const id: unknown = members.data[0].workspace_id;
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
