import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;

export class ManagerRescheduleError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "COMMAND_FAILED") {
    super(`Manager reschedule ${code.toLowerCase()}`);
    this.name = "ManagerRescheduleError";
  }
}

export type ManagerRescheduleInput = Readonly<{
  workspaceId: string;
  expectedGeneration: number;
  orderId: string;
  expectedUpdatedAt: string;
  scheduledAt: string;
}>;

export async function rescheduleManagerOrder(
  actor: ActorContext, client: SupabaseClient, input: ManagerRescheduleInput,
  guestProof: Readonly<{ visitId: string; tokenHash: string }> | null,
) {
  if (!UUID.test(input.workspaceId) || actor.membership?.workspaceId !== input.workspaceId ||
      actor.membership.role !== "MANAGER" || actor.isAnonymous ||
      !hasActorPermission(actor, "order:reschedule")) {
    throw new ManagerRescheduleError("FORBIDDEN");
  }
  if (!UUID.test(input.orderId) || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration <= 0 ||
      !TIMESTAMP.test(input.expectedUpdatedAt) || !Number.isFinite(Date.parse(input.expectedUpdatedAt)) ||
      !TIMESTAMP.test(input.scheduledAt) || !Number.isFinite(Date.parse(input.scheduledAt)) ||
      (guestProof && (!UUID.test(guestProof.visitId) || !/^[0-9a-f]{64}$/.test(guestProof.tokenHash)))) {
    throw new ManagerRescheduleError("INVALID_INPUT");
  }
  const { data, error } = await client.rpc("workspace_order_manager_reschedule", {
    p_workspace_id: input.workspaceId,
    p_expected_generation: input.expectedGeneration,
    p_order_id: input.orderId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_scheduled_at: input.scheduledAt,
    p_guest_visit_id: guestProof?.visitId ?? null,
    p_guest_token_hash: guestProof?.tokenHash ?? null,
  });
  if (error || !data) throw new ManagerRescheduleError("COMMAND_FAILED");
  return data;
}
