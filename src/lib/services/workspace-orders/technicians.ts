import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { WorkspaceOrderAccessError } from "./listing";

const technicianSchema = z.object({ id: z.string().uuid(), branch_id: z.string().uuid(), profile_id: z.string().uuid() });
export type WorkspaceTechnician = z.infer<typeof technicianSchema>;

/** Scoped active identifiers only; these rows do not establish skill or availability. */
export async function readWorkspaceTechnicians(actor: ActorContext, client: SupabaseClient, workspaceId: string): Promise<WorkspaceTechnician[]> {
  if (actor.membership?.workspaceId !== workspaceId || actor.membership.role !== "ADMIN" ||
      !hasActorPermission(actor, "order:assign")) throw new WorkspaceOrderAccessError();
  const { data, error } = await client.from("workspace_technicians").select("id,branch_id,profile_id")
    .eq("workspace_id", workspaceId).eq("active", true).limit(100);
  if (error || !Array.isArray(data)) throw new Error("Technicians unavailable");
  return data.map((row) => technicianSchema.parse(row));
}
