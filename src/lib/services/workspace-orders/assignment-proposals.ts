import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AssignmentProposalError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "PROPOSAL_FAILED") {
    super(`Assignment proposal ${code.toLowerCase()}`);
    this.name = "AssignmentProposalError";
  }
}

export type AssignmentProposalInput = Readonly<{
  workspaceId: string;
  orderId: string;
  technicianId: string;
  expectedUpdatedAt: string;
  scheduledAt: string | null;
  idempotencyKey: string;
}>;

export type AssignmentProposalReference = Readonly<{
  workspaceId: string;
  proposalId: string;
}>;

export type AssignmentProposal = Readonly<{
  id: string;
  workspaceId: string;
  initiatorProfileId: string;
  approverProfileId: string | null;
  status: "PENDING" | "APPROVED" | "EXECUTED" | "STALE" | "EXPIRED";
  /** Render these exact persisted values in the confirmation preview. */
  canonicalPayload: Readonly<{
    orderId: string;
    technicianId: string;
    scheduledAt: string | null;
  }>;
  targetUpdatedAt: string;
  datasetGeneration: number;
  expiresAt: string;
  resultOrderUpdatedAt: string | null;
}>;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function requireAdmin(actor: ActorContext, workspaceId: string) {
  if (!UUID.test(workspaceId) || actor.membership?.workspaceId !== workspaceId ||
      actor.membership.role !== "ADMIN" || !hasActorPermission(actor, "order:assign")) {
    throw new AssignmentProposalError("FORBIDDEN");
  }
}

function requireValidProposalInput(input: AssignmentProposalInput) {
  if (!UUID.test(input.orderId) || !UUID.test(input.technicianId) ||
      !UUID.test(input.idempotencyKey) || !validTimestamp(input.expectedUpdatedAt) ||
      (input.scheduledAt !== null && !validTimestamp(input.scheduledAt))) {
    throw new AssignmentProposalError("INVALID_INPUT");
  }
}

export function parseAssignmentProposal(value: unknown): AssignmentProposal {
  if (!value || typeof value !== "object") throw new AssignmentProposalError("PROPOSAL_FAILED");
  const row = value as Record<string, unknown>;
  const payload = row.canonical_payload;
  if (!payload || typeof payload !== "object") throw new AssignmentProposalError("PROPOSAL_FAILED");
  const canonical = payload as Record<string, unknown>;
  if (!UUID.test(String(row.id)) || !UUID.test(String(row.workspace_id)) ||
      !UUID.test(String(row.initiated_by_profile_id)) ||
      (row.approver_profile_id !== null && !UUID.test(String(row.approver_profile_id))) ||
      !UUID.test(String(canonical.orderId)) || !UUID.test(String(canonical.technicianId)) ||
      (canonical.scheduledAt !== null && !validTimestamp(canonical.scheduledAt)) ||
      !validTimestamp(row.target_updated_at) || !validTimestamp(row.expires_at) ||
      (row.result_order_updated_at !== null && !validTimestamp(row.result_order_updated_at)) ||
      !Number.isSafeInteger(row.dataset_generation) || Number(row.dataset_generation) <= 0 ||
      !["PENDING", "APPROVED", "EXECUTED", "STALE", "EXPIRED"].includes(String(row.status))) {
    throw new AssignmentProposalError("PROPOSAL_FAILED");
  }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    initiatorProfileId: String(row.initiated_by_profile_id),
    approverProfileId: row.approver_profile_id as string | null,
    status: row.status as AssignmentProposal["status"],
    canonicalPayload: {
      orderId: String(canonical.orderId),
      technicianId: String(canonical.technicianId),
      scheduledAt: canonical.scheduledAt as string | null,
    },
    targetUpdatedAt: row.target_updated_at as string,
    datasetGeneration: row.dataset_generation as number,
    expiresAt: row.expires_at as string,
    resultOrderUpdatedAt: row.result_order_updated_at as string | null,
  };
}

/** Persist a concrete preview; this user-session client has no table write grant. */
export async function proposeWorkspaceOrderAssignment(
  actor: ActorContext,
  userSessionClient: SupabaseClient,
  input: AssignmentProposalInput,
): Promise<AssignmentProposal> {
  requireAdmin(actor, input.workspaceId);
  requireValidProposalInput(input);
  const { data, error } = await userSessionClient.rpc("workspace_assignment_proposal_create", {
    p_workspace_id: input.workspaceId,
    p_order_id: input.orderId,
    p_technician_id: input.technicianId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_scheduled_at: input.scheduledAt,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new AssignmentProposalError("PROPOSAL_FAILED");
  return parseAssignmentProposal(data);
}

/**
 * MCP initiation uses a server-only RPC so the audit source cannot be forged
 * by a user-session JWT. This never approves or executes the proposal.
 */
export async function proposeWorkspaceOrderAssignmentFromMcp(
  actor: ActorContext,
  privilegedClient: SupabaseClient,
  input: AssignmentProposalInput,
): Promise<AssignmentProposal> {
  requireAdmin(actor, input.workspaceId);
  requireValidProposalInput(input);
  const { data, error } = await privilegedClient.rpc("workspace_assignment_proposal_create_mcp", {
    p_workspace_id: input.workspaceId,
    p_order_id: input.orderId,
    p_technician_id: input.technicianId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_scheduled_at: input.scheduledAt,
    p_idempotency_key: input.idempotencyKey,
    p_initiator_auth_user_id: actor.authUserId,
  });
  if (error) throw new AssignmentProposalError("PROPOSAL_FAILED");
  return parseAssignmentProposal(data);
}

/**
 * Use only from a human confirmation action after a fresh Auth getUser() and a
 * preview of the stored canonical payload. Never expose this service or its
 * privileged client to the model/tool runtime. Approval authority is held by
 * the server role, not the ordinary user JWT used to propose/execute.
 */
export async function approveWorkspaceOrderAssignmentFromWeb(
  actor: ActorContext,
  privilegedClient: SupabaseClient,
  reference: AssignmentProposalReference,
): Promise<AssignmentProposal> {
  requireAdmin(actor, reference.workspaceId);
  if (!UUID.test(reference.proposalId)) throw new AssignmentProposalError("INVALID_INPUT");
  const { data, error } = await privilegedClient.rpc("workspace_assignment_proposal_approve", {
    p_workspace_id: reference.workspaceId,
    p_proposal_id: reference.proposalId,
    p_approver_auth_user_id: actor.authUserId,
  });
  if (error) throw new AssignmentProposalError("PROPOSAL_FAILED");
  return parseAssignmentProposal(data);
}

/** Execute only a persisted approved proposal; the SQL function rechecks state. */
export async function executeWorkspaceOrderAssignmentProposal(
  actor: ActorContext,
  userSessionClient: SupabaseClient,
  reference: AssignmentProposalReference,
): Promise<AssignmentProposal> {
  requireAdmin(actor, reference.workspaceId);
  if (!UUID.test(reference.proposalId)) throw new AssignmentProposalError("INVALID_INPUT");
  const { data, error } = await userSessionClient.rpc("workspace_assignment_proposal_execute", {
    p_workspace_id: reference.workspaceId,
    p_proposal_id: reference.proposalId,
  });
  if (error) throw new AssignmentProposalError("PROPOSAL_FAILED");
  return parseAssignmentProposal(data);
}

/** Read-only proposal inspection for the initiating actor or recorded approver. */
export async function inspectWorkspaceOrderAssignmentProposal(
  actor: ActorContext,
  userSessionClient: SupabaseClient,
  reference: AssignmentProposalReference,
): Promise<AssignmentProposal> {
  requireAdmin(actor, reference.workspaceId);
  if (!UUID.test(reference.proposalId)) throw new AssignmentProposalError("INVALID_INPUT");
  const { data, error } = await userSessionClient.from("workspace_assignment_proposals")
    .select("id,workspace_id,initiated_by_profile_id,approver_profile_id,status,canonical_payload,target_updated_at,dataset_generation,expires_at,result_order_updated_at")
    .eq("workspace_id", reference.workspaceId).eq("id", reference.proposalId).maybeSingle();
  if (error || !data ||
      (data.initiated_by_profile_id !== actor.profileId && data.approver_profile_id !== actor.profileId)) {
    throw new AssignmentProposalError("FORBIDDEN");
  }
  return parseAssignmentProposal(data);
}
