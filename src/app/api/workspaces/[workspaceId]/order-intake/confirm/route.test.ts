import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(),
  confirmWorkspaceOrderIntake: vi.fn(), isSameOriginRequest: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/services/workspace-order-intake/confirm", () => ({
  confirmWorkspaceOrderIntake: mocks.confirmWorkspaceOrderIntake,
}));
vi.mock("@/lib/auth/demo-entry", () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const body = {
  confirmed: true, expectedGeneration: 2, orderNo: "DOC-001",
  branchId: "44444444-4444-4444-8444-444444444444",
  customer: { mode: "NEW", name: "A", phone: null, address: "1 Demo Street" },
  problemDescription: "Unit leaks", serviceType: "Repair",
};
const request = (payload: unknown) => new Request("https://example.test/api/workspaces/order-intake/confirm", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
const context = { params: Promise.resolve({ workspaceId }) };

describe("order intake confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.getServerActorContext.mockResolvedValue({ profileId: "verified" });
    mocks.createServerSupabaseClient.mockResolvedValue({});
  });
  it("rejects cross-origin and missing confirmation without creating a customer or order", async () => {
    mocks.isSameOriginRequest.mockReturnValue(false);
    expect((await POST(request(body), context)).status).toBe(403);
    mocks.isSameOriginRequest.mockReturnValue(true);
    expect((await POST(request({ ...body, confirmed: false }), context)).status).toBe(400);
    expect(mocks.confirmWorkspaceOrderIntake).not.toHaveBeenCalled();
  });
  it("rejects missing actor and sends only reviewed fields to the command", async () => {
    mocks.getServerActorContext.mockResolvedValueOnce(null);
    expect((await POST(request(body), context)).status).toBe(403);
    mocks.confirmWorkspaceOrderIntake.mockResolvedValue({ id: "created-order" });
    const response = await POST(request(body), context);
    expect(response.status).toBe(201);
    expect(mocks.confirmWorkspaceOrderIntake).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), {
        workspaceId, expectedGeneration: 2, orderNo: "DOC-001",
        branchId: body.branchId, customer: body.customer,
        problemDescription: "Unit leaks", serviceType: "Repair",
      },
    );
  });
});
