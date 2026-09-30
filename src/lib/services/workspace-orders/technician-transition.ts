import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;

export class TechnicianTransitionError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "COMMAND_FAILED") {
    super(`Technician transition ${code.toLowerCase()}`);
    this.name = "TechnicianTransitionError";
  }
}

export type TechnicianTransitionInput = Readonly<{
  workspaceId: string;
  expectedGeneration: number;
  orderId: string;
  expectedUpdatedAt: string;
  nextStatus: "IN_PROGRESS" | "COMPLETED";
}>;

export type GuestTransitionProof = Readonly<{ visitId: string; tokenHash: string }>;

/** Actor and client must resolve from the same Owner session or Guest visit. */
export async function transitionAssignedJob(
  actor: ActorContext, client: SupabaseClient, input: TechnicianTransitionInput,
  guestProof: GuestTransitionProof | null,
) {
  if (!UUID.test(input.workspaceId) || actor.membership?.workspaceId !== input.workspaceId ||
      actor.membership.role !== "TECHNICIAN" || actor.isAnonymous ||
      !hasActorPermission(actor, input.nextStatus === "IN_PROGRESS" ? "job:start_assigned" : "job:complete_assigned")) {
    throw new TechnicianTransitionError("FORBIDDEN");
  }
  if (!UUID.test(input.orderId) || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration <= 0 ||
      !TIMESTAMP.test(input.expectedUpdatedAt) || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) ||
      !["IN_PROGRESS", "COMPLETED"].includes(input.nextStatus) ||
      (guestProof !== null && (!UUID.test(guestProof.visitId) || !/^[0-9a-f]{64}$/.test(guestProof.tokenHash)))) {
    throw new TechnicianTransitionError("INVALID_INPUT");
  }
  const { data, error } = await client.rpc("workspace_order_technician_transition", {
    p_workspace_id: input.workspaceId,
    p_expected_generation: input.expectedGeneration,
    p_order_id: input.orderId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_next_status: input.nextStatus,
    p_guest_visit_id: guestProof?.visitId ?? null,
    p_guest_token_hash: guestProof?.tokenHash ?? null,
  });
  if (error || !data) throw new TechnicianTransitionError("COMMAND_FAILED");
  return data;
}
