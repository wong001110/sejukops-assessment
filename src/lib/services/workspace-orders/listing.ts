import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";

export class WorkspaceOrderAccessError extends Error {
  constructor() {
    super("Workspace order access denied");
    this.name = "WorkspaceOrderAccessError";
  }
}

/** A read adapter for the new core; its caller supplies a verified actor. */
export async function listWorkspaceOrders(
  actor: ActorContext,
  supabase: SupabaseClient,
  workspaceId: string,
) {
  if (
    actor.membership?.workspaceId !== workspaceId ||
    !(
      hasActorPermission(actor, "order:view") ||
      hasActorPermission(actor, "job:view_assigned")
    )
  ) {
    throw new WorkspaceOrderAccessError();
  }

  let assignedTechnicianId: string | undefined;
  if (actor.membership.role === "TECHNICIAN") {
    const { data: technician, error: technicianError } = await supabase
      .from("workspace_technicians")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("profile_id", actor.profileId)
      .eq("active", true)
      .maybeSingle();
    if (technicianError) throw new Error("Technician mapping could not be read", { cause: technicianError });
    if (!technician) return [];
    assignedTechnicianId = technician.id;
  }

  let query = supabase
    .from("workspace_orders")
    .select("id,workspace_id,order_no,branch_id,customer_id,assigned_technician_id,problem_description,service_type,status,scheduled_at,created_at,updated_at")
    .eq("workspace_id", workspaceId);
  if (assignedTechnicianId) {
    query = query.eq("assigned_technician_id", assignedTechnicianId);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error("Workspace orders could not be read", { cause: error });
  return data ?? [];
}
