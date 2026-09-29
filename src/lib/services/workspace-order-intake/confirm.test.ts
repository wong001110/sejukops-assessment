import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";
import { confirmWorkspaceOrderIntake } from "./confirm";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor: ActorContext = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" },
};
const input = {
  workspaceId, expectedGeneration: 2, orderNo: "DOC-001",
  branchId: "44444444-4444-4444-8444-444444444444",
  customer: { mode: "NEW" as const, name: "A", phone: null, address: "1 Demo Street" },
  problemDescription: "Unit leaks", serviceType: "Repair",
};

describe("document-to-order confirmation", () => {
  it("does not send an RPC for a Technician or wrong workspace", async () => {
    const rpc = vi.fn();
    await expect(confirmWorkspaceOrderIntake({ ...actor, membership: { ...actor.membership!, role: "TECHNICIAN" } },
      { rpc } as never, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmWorkspaceOrderIntake(actor, { rpc } as never,
      { ...input, workspaceId: "55555555-5555-4555-8555-555555555555" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends one atomic customer+order RPC with reviewed fields and generation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "created-order" }, error: null });
    expect(await confirmWorkspaceOrderIntake(actor, { rpc } as never, input)).toEqual({ id: "created-order" });
    expect(rpc).toHaveBeenCalledWith("workspace_order_create_with_customer", expect.objectContaining({
      p_workspace_id: workspaceId, p_expected_generation: 2,
      p_customer_name: "A", p_customer_address: "1 Demo Street",
      p_problem_description: "Unit leaks",
      p_guest_visit_id: null, p_guest_token_hash: null,
    }));
  });

  it("does not treat a rejected RPC as success", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
    await expect(confirmWorkspaceOrderIntake(actor, { rpc } as never, input))
      .rejects.toMatchObject({ code: "COMMAND_FAILED" });
  });
});
