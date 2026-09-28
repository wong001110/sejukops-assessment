import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

import {
  approveWorkspaceOrderAssignmentFromWeb,
  executeWorkspaceOrderAssignmentProposal,
  proposeWorkspaceOrderAssignment,
} from "./assignment-proposals";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const technicianId = "44444444-4444-4444-8444-444444444444";
const proposalId = "55555555-5555-4555-8555-555555555555";
const profileId = "66666666-6666-4666-8666-666666666666";
const authUserId = "77777777-7777-4777-8777-777777777777";
const idempotencyKey = "88888888-8888-4888-8888-888888888888";
const targetUpdatedAt = "2026-09-28T14:31:00.123456+00:00";

const actor: ActorContext = {
  authUserId,
  profileId,
  isAnonymous: false,
  platformRole: "USER",
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" },
};
const input = {
  workspaceId,
  orderId,
  technicianId,
  expectedUpdatedAt: targetUpdatedAt,
  scheduledAt: "2026-09-29T09:00:00+08:00",
  idempotencyKey,
};
const proposal = {
  id: proposalId,
  workspace_id: workspaceId,
  initiated_by_profile_id: profileId,
  approver_profile_id: null,
  status: "PENDING",
  canonical_payload: {
    orderId,
    technicianId,
    scheduledAt: "2026-09-29T01:00:00+00:00",
  },
  target_updated_at: targetUpdatedAt,
  dataset_generation: 2,
  expires_at: "2026-09-28T14:46:00+00:00",
  result_order_updated_at: null,
};

function client(data: unknown = proposal, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe("workspace order assignment proposals", () => {
  it("persists a concrete preview and returns the database's canonical payload", async () => {
    const { supabase, rpc } = client();
    const result = await proposeWorkspaceOrderAssignment(actor, supabase, input);
    expect(rpc).toHaveBeenCalledWith("workspace_assignment_proposal_create", {
      p_workspace_id: workspaceId,
      p_order_id: orderId,
      p_technician_id: technicianId,
      p_expected_updated_at: targetUpdatedAt,
      p_scheduled_at: input.scheduledAt,
      p_idempotency_key: idempotencyKey,
    });
    expect(result).toMatchObject({
      id: proposalId,
      status: "PENDING",
      canonicalPayload: { scheduledAt: "2026-09-29T01:00:00+00:00" },
      datasetGeneration: 2,
    });
  });

  it("rejects role, workspace, or malformed snapshot before any RPC", async () => {
    const { supabase, rpc } = client();
    await expect(proposeWorkspaceOrderAssignment(
      { ...actor, membership: { workspaceId, kind: "OWNER", role: "MANAGER" } }, supabase, input,
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(proposeWorkspaceOrderAssignment(actor, supabase, {
      ...input, workspaceId: otherWorkspaceId,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(proposeWorkspaceOrderAssignment(actor, supabase, {
      ...input, expectedUpdatedAt: "yesterday",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps human approval on a separate privileged RPC and uses verified actor ID", async () => {
    const { supabase, rpc } = client({ ...proposal, status: "APPROVED", approver_profile_id: profileId });
    await approveWorkspaceOrderAssignmentFromWeb(actor, supabase, { workspaceId, proposalId });
    expect(rpc).toHaveBeenCalledWith("workspace_assignment_proposal_approve", {
      p_workspace_id: workspaceId,
      p_proposal_id: proposalId,
      p_approver_auth_user_id: authUserId,
    });
  });

  it("executes by proposal ID only, never accepting a substituted payload", async () => {
    const { supabase, rpc } = client({ ...proposal, status: "EXECUTED", approver_profile_id: profileId });
    await executeWorkspaceOrderAssignmentProposal(actor, supabase, { workspaceId, proposalId });
    expect(rpc).toHaveBeenCalledWith("workspace_assignment_proposal_execute", {
      p_workspace_id: workspaceId,
      p_proposal_id: proposalId,
    });
  });

  it("does not turn stale or invalid database responses into success", async () => {
    const failed = client(null, { code: "P0001" });
    await expect(executeWorkspaceOrderAssignmentProposal(actor, failed.supabase, { workspaceId, proposalId }))
      .rejects.toMatchObject({ code: "PROPOSAL_FAILED" });
    const malformed = client({ ...proposal, canonical_payload: { orderId, technicianId: "bad" } });
    await expect(proposeWorkspaceOrderAssignment(actor, malformed.supabase, input))
      .rejects.toMatchObject({ code: "PROPOSAL_FAILED" });
  });
});
