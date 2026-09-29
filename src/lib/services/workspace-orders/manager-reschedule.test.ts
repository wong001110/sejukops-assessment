import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { rescheduleManagerOrder } from "./manager-reschedule";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const input = { workspaceId, orderId, expectedGeneration: 2,
  expectedUpdatedAt: "2026-09-29T10:00:00.123456+00:00", scheduledAt: "2026-09-30T11:00:00.000Z" };
const proof = { visitId: "33333333-3333-4333-8333-333333333333", tokenHash: "a".repeat(64) };
function actor(role: "MANAGER" | "ADMIN" | "TECHNICIAN" = "MANAGER", kind: "DEMO" | "OWNER" = "DEMO"): ActorContext {
  return { authUserId: orderId, profileId: orderId, isAnonymous: false,
    platformRole: "USER", membership: { workspaceId, kind, role } };
}
function client() {
  const rpc = vi.fn().mockResolvedValue({ data: { id: orderId, scheduled_at: input.scheduledAt }, error: null });
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe("Manager order rescheduling", () => {
  it("sends exact state and visit proof through the same session client", async () => {
    const { rpc, supabase } = client();
    await expect(rescheduleManagerOrder(actor(), supabase, input, proof)).resolves.toMatchObject({ id: orderId });
    expect(rpc).toHaveBeenCalledWith("workspace_order_manager_reschedule", {
      p_workspace_id: workspaceId, p_order_id: orderId, p_expected_generation: 2,
      p_expected_updated_at: input.expectedUpdatedAt, p_scheduled_at: input.scheduledAt,
      p_guest_visit_id: proof.visitId, p_guest_token_hash: proof.tokenHash,
    });
  });

  it("allows an explicit Owner Manager membership with no Guest proof", async () => {
    const { rpc, supabase } = client();
    await rescheduleManagerOrder(actor("MANAGER", "OWNER"), supabase, input, null);
    expect(rpc).toHaveBeenCalledWith("workspace_order_manager_reschedule", expect.objectContaining({
      p_guest_visit_id: null, p_guest_token_hash: null,
    }));
  });

  it("denies Admin, Technician, wrong workspace and absent membership", async () => {
    const { rpc, supabase } = client();
    for (const forbidden of [actor("ADMIN"), actor("TECHNICIAN"),
      { ...actor(), membership: { workspaceId: orderId, kind: "DEMO" as const, role: "MANAGER" as const } },
      { ...actor(), membership: undefined, platformRole: "SUPER_ADMIN" as const }]) {
      await expect(rescheduleManagerOrder(forbidden, supabase, input, proof)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed generation, order, timestamps and proof before RPC", async () => {
    const { rpc, supabase } = client();
    for (const invalid of [{ ...input, expectedGeneration: 0 }, { ...input, orderId: "bad" },
      { ...input, expectedUpdatedAt: "today" }, { ...input, scheduledAt: "tomorrow" }]) {
      await expect(rescheduleManagerOrder(actor(), supabase, invalid, proof)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(rescheduleManagerOrder(actor(), supabase, input, { ...proof, tokenHash: "bad" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces stale order, reset, expired visit and unavailable command failures", async () => {
    const { rpc, supabase } = client();
    for (const reason of ["STALE", "GENERATION_STALE", "GUEST_VISIT_INVALID", "UNAVAILABLE"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: reason } });
      await expect(rescheduleManagerOrder(actor(), supabase, input, proof)).rejects.toMatchObject({ code: "COMMAND_FAILED" });
    }
  });
});
