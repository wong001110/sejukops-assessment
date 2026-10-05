import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { transitionAssignedJob } from "./technician-transition";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const input = { workspaceId, orderId, expectedGeneration: 2,
  expectedUpdatedAt: "2026-09-29T10:00:00.123456+00:00", nextStatus: "IN_PROGRESS" as const };
const guestProof = { visitId: "33333333-3333-4333-8333-333333333333", tokenHash: "a".repeat(64) };
function actor(role: "TECHNICIAN" | "ADMIN" = "TECHNICIAN", kind: "DEMO" | "OWNER" = "DEMO"): ActorContext {
  return { authUserId: orderId, profileId: orderId, isAnonymous: false,
    platformRole: "USER", membership: { workspaceId, kind, role } };
}
function client() {
  const rpc = vi.fn().mockResolvedValue({ data: { id: orderId, status: "IN_PROGRESS" }, error: null });
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe("assigned Technician job transition", () => {
  it("uses the same session client and exact generation/order timestamp", async () => {
    const { rpc, supabase } = client();
    await expect(transitionAssignedJob(actor(), supabase, input, guestProof)).resolves.toMatchObject({ status: "IN_PROGRESS" });
    expect(rpc).toHaveBeenCalledWith("workspace_order_technician_transition", {
      p_workspace_id: workspaceId, p_order_id: orderId, p_expected_generation: 2,
      p_expected_updated_at: input.expectedUpdatedAt, p_next_status: "IN_PROGRESS",
      p_guest_visit_id: guestProof.visitId, p_guest_token_hash: guestProof.tokenHash,
    });
    await transitionAssignedJob(actor("TECHNICIAN", "OWNER"), supabase, { ...input, nextStatus: "COMPLETED" }, null);
    expect(rpc).toHaveBeenLastCalledWith("workspace_order_technician_transition", expect.objectContaining({
      p_next_status: "COMPLETED", p_guest_visit_id: null, p_guest_token_hash: null,
    }));
  });

  it("denies wrong role, workspace, and no membership before RPC", async () => {
    const { rpc, supabase } = client();
    await expect(transitionAssignedJob(actor("ADMIN"), supabase, input, guestProof)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionAssignedJob(actor(), supabase, { ...input, workspaceId: orderId }, guestProof)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionAssignedJob({ ...actor(), membership: undefined, platformRole: "SUPER_ADMIN" }, supabase, input, guestProof)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(transitionAssignedJob({ ...actor(), isAnonymous: true }, supabase, input, guestProof)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed generation, order id, timestamp, and status", async () => {
    const { rpc, supabase } = client();
    await expect(transitionAssignedJob(actor(), supabase, { ...input, expectedGeneration: 0 }, guestProof)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(transitionAssignedJob(actor(), supabase, { ...input, orderId: "not-uuid" }, guestProof)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(transitionAssignedJob(actor(), supabase, { ...input, expectedUpdatedAt: "today" }, guestProof)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(transitionAssignedJob(actor(), supabase, { ...input, nextStatus: "CLOSED" as "COMPLETED" }, guestProof)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(transitionAssignedJob(actor(), supabase, input, { ...guestProof, tokenHash: "bad" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces unassigned, stale, invalid-transition, and reset rejections", async () => {
    const { rpc, supabase } = client();
    for (const reason of ["UNASSIGNED", "STALE", "INVALID_TRANSITION", "GENERATION_STALE"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: reason } });
      await expect(transitionAssignedJob(actor(), supabase, input, guestProof)).rejects.toMatchObject({ code: "COMMAND_FAILED" });
    }
  });
});
