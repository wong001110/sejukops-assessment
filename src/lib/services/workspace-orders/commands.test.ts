import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

import {
  assignWorkspaceOrder,
  createWorkspaceOrder,
  WorkspaceOrderCommandError,
} from "./commands";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const customerId = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";
const technicianId = "66666666-6666-4666-8666-666666666666";
const visitId = "99999999-9999-4999-8999-999999999999";
const guestProof = { visitId, tokenHash: "a".repeat(64) };

function actor(role: "ADMIN" | "MANAGER" = "ADMIN", kind: "DEMO" | "OWNER" = "OWNER"): ActorContext {
  return {
    authUserId: "77777777-7777-4777-8777-777777777777",
    profileId: "88888888-8888-4888-8888-888888888888",
    isAnonymous: kind === "DEMO",
    platformRole: "USER",
    membership: { workspaceId, kind, role },
  };
}

const createInput = {
  workspaceId,
  expectedGeneration: 1,
  orderNo: "SO-1001",
  branchId,
  customerId,
  problemDescription: "Air conditioner is leaking",
  serviceType: "Repair",
};
const assignInput = {
  workspaceId,
  expectedGeneration: 1,
  orderId,
  technicianId,
  expectedUpdatedAt: "2026-09-28T14:31:00.123456+00:00",
  scheduledAt: "2026-09-29T09:00:00+08:00",
};

function client() {
  const rpc = vi.fn().mockResolvedValue({ data: { id: orderId, workspace_id: workspaceId }, error: null });
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe("workspace order commands", () => {
  it("creates through the session RPC with an explicit workspace and scoped references", async () => {
    const { supabase, rpc } = client();
    await expect(createWorkspaceOrder(actor(), supabase, createInput))
      .resolves.toMatchObject({ id: orderId });
    expect(rpc).toHaveBeenCalledWith("workspace_order_create", {
      p_workspace_id: workspaceId,
      p_expected_generation: 1,
      p_order_no: "SO-1001",
      p_branch_id: branchId,
      p_customer_id: customerId,
      p_problem_description: "Air conditioner is leaking",
      p_service_type: "Repair",
      p_guest_visit_id: null,
      p_guest_token_hash: null,
    });
  });

  it("rejects missing, mismatched, and non-Admin membership before RPC", async () => {
    const { supabase, rpc } = client();
    await expect(createWorkspaceOrder(actor(), supabase, { ...createInput, workspaceId: otherWorkspaceId }))
      .rejects.toBeInstanceOf(WorkspaceOrderCommandError);
    await expect(createWorkspaceOrder(actor("MANAGER"), supabase, createInput))
      .rejects.toBeInstanceOf(WorkspaceOrderCommandError);
    await expect(createWorkspaceOrder({ ...actor(), membership: undefined, platformRole: "SUPER_ADMIN" }, supabase, createInput))
      .rejects.toBeInstanceOf(WorkspaceOrderCommandError);
    await expect(createWorkspaceOrder({ ...actor(), isAnonymous: true }, supabase, createInput))
      .rejects.toBeInstanceOf(WorkspaceOrderCommandError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid references and empty descriptions before RPC", async () => {
    const { supabase, rpc } = client();
    await expect(createWorkspaceOrder(actor(), supabase, { ...createInput, branchId: "bad" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createWorkspaceOrder(actor(), supabase, { ...createInput, problemDescription: " " }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("assigns with an exact optimistic concurrency timestamp", async () => {
    const { supabase, rpc } = client();
    await expect(assignWorkspaceOrder(actor(), supabase, assignInput))
      .resolves.toMatchObject({ id: orderId });
    expect(rpc).toHaveBeenCalledWith("workspace_order_assign", {
      p_workspace_id: workspaceId,
      p_expected_generation: 1,
      p_order_id: orderId,
      p_technician_id: technicianId,
      p_expected_updated_at: assignInput.expectedUpdatedAt,
      p_scheduled_at: assignInput.scheduledAt,
      p_guest_visit_id: null,
      p_guest_token_hash: null,
    });
  });

  it("rejects assignment by Manager, cross-workspace actor, or invalid timestamp", async () => {
    const { supabase, rpc } = client();
    await expect(assignWorkspaceOrder(actor("MANAGER"), supabase, assignInput))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignWorkspaceOrder(actor(), supabase, { ...assignInput, workspaceId: otherWorkspaceId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignWorkspaceOrder(actor(), supabase, { ...assignInput, expectedUpdatedAt: "yesterday" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(assignWorkspaceOrder(actor(), supabase, { ...assignInput, expectedGeneration: 0 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not turn a stale or rejected database command into success", async () => {
    const { supabase, rpc } = client();
    rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    await expect(assignWorkspaceOrder(actor(), supabase, assignInput))
      .rejects.toMatchObject({ code: "COMMAND_FAILED" });
  });

  it("passes only a validated Guest visit proof for Demo writes", async () => {
    const { supabase, rpc } = client();
    const demo = { ...actor(), membership: { workspaceId, kind: "DEMO" as const, role: "ADMIN" as const } };
    await createWorkspaceOrder(demo, supabase, createInput, guestProof);
    await assignWorkspaceOrder(demo, supabase, assignInput, guestProof);
    expect(rpc).toHaveBeenNthCalledWith(1, "workspace_order_create", expect.objectContaining({
      p_guest_visit_id: visitId, p_guest_token_hash: guestProof.tokenHash,
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "workspace_order_assign", expect.objectContaining({
      p_guest_visit_id: visitId, p_guest_token_hash: guestProof.tokenHash,
    }));
    await expect(createWorkspaceOrder(actor(), supabase, createInput, guestProof))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(assignWorkspaceOrder(demo, supabase, assignInput, { ...guestProof, tokenHash: "bad" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
