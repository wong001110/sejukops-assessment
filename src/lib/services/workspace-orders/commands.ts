import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorkspaceOrderCommandError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "COMMAND_FAILED") {
    super(`Workspace order command ${code.toLowerCase()}`);
    this.name = "WorkspaceOrderCommandError";
  }
}

export type CreateWorkspaceOrderInput = Readonly<{
  workspaceId: string;
  expectedGeneration: number;
  orderNo: string;
  branchId: string;
  customerId: string;
  problemDescription: string;
  serviceType: string;
}>;

export type AssignWorkspaceOrderInput = Readonly<{
  workspaceId: string;
  expectedGeneration: number;
  orderId: string;
  technicianId: string;
  /** Exact timestamp returned by the last read; do not round it through Date. */
  expectedUpdatedAt: string;
  scheduledAt: string | null;
}>;

export type GuestOrderProof = Readonly<{ visitId: string; tokenHash: string }>;

function requireAdmin(actor: ActorContext, workspaceId: string, permission: "order:create" | "order:assign") {
  if (
    !UUID.test(workspaceId) ||
    actor.membership?.workspaceId !== workspaceId ||
    actor.membership.role !== "ADMIN" ||
    !hasActorPermission(actor, permission)
  ) {
    throw new WorkspaceOrderCommandError("FORBIDDEN");
  }
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function validGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validProof(proof: GuestOrderProof | null): boolean {
  return proof === null || (UUID.test(proof.visitId) && /^[0-9a-f]{64}$/.test(proof.tokenHash));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/** The supplied client must carry the same user's Supabase Auth session. */
export async function createWorkspaceOrder(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: CreateWorkspaceOrderInput,
  guestProof: GuestOrderProof | null = null,
) {
  requireAdmin(actor, input.workspaceId, "order:create");
  if (
    !validProof(guestProof) ||
    (guestProof !== null && actor.membership?.kind !== "DEMO") ||
    !validGeneration(input.expectedGeneration) ||
    !UUID.test(input.branchId) || !UUID.test(input.customerId) ||
    !validText(input.orderNo, 80) ||
    !validText(input.problemDescription, 4000) ||
    !validText(input.serviceType, 120)
  ) {
    throw new WorkspaceOrderCommandError("INVALID_INPUT");
  }

  const { data, error } = await supabase.rpc("workspace_order_create", {
    p_workspace_id: input.workspaceId,
    p_expected_generation: input.expectedGeneration,
    p_order_no: input.orderNo.trim(),
    p_branch_id: input.branchId,
    p_customer_id: input.customerId,
    p_problem_description: input.problemDescription.trim(),
    p_service_type: input.serviceType.trim(),
    p_guest_visit_id: guestProof?.visitId ?? null,
    p_guest_token_hash: guestProof?.tokenHash ?? null,
  });
  if (error || !data) {
    throw new WorkspaceOrderCommandError("COMMAND_FAILED");
  }
  return data;
}

/** An assignment is conditional on the previously observed order timestamp. */
export async function assignWorkspaceOrder(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: AssignWorkspaceOrderInput,
  guestProof: GuestOrderProof | null = null,
) {
  requireAdmin(actor, input.workspaceId, "order:assign");
  if (
    !validProof(guestProof) ||
    (guestProof !== null && actor.membership?.kind !== "DEMO") ||
    !validGeneration(input.expectedGeneration) ||
    !UUID.test(input.orderId) || !UUID.test(input.technicianId) ||
    !validTimestamp(input.expectedUpdatedAt) ||
    (input.scheduledAt !== null && !validTimestamp(input.scheduledAt))
  ) {
    throw new WorkspaceOrderCommandError("INVALID_INPUT");
  }

  const { data, error } = await supabase.rpc("workspace_order_assign", {
    p_workspace_id: input.workspaceId,
    p_expected_generation: input.expectedGeneration,
    p_order_id: input.orderId,
    p_technician_id: input.technicianId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_scheduled_at: input.scheduledAt,
    p_guest_visit_id: guestProof?.visitId ?? null,
    p_guest_token_hash: guestProof?.tokenHash ?? null,
  });
  if (error || !data) {
    throw new WorkspaceOrderCommandError("COMMAND_FAILED");
  }
  return data;
}
