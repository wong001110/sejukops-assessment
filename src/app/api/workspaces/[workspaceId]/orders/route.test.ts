import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  readRecentWorkspaceOrders: vi.fn(),
  readWorkspaceGeneration: vi.fn(),
  createWorkspaceOrder: vi.fn(),
}));

vi.mock("@/lib/auth/server-actor", () => ({
  getServerActorContext: mocks.getServerActorContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/services/workspace-orders/listing", () => ({
  WorkspaceOrderAccessError: class extends Error {},
}));
vi.mock("@/lib/capabilities/recent-orders", () => ({
  readRecentWorkspaceOrders: mocks.readRecentWorkspaceOrders,
}));
vi.mock("@/lib/services/workspaces/generation", () => ({
  readWorkspaceGeneration: mocks.readWorkspaceGeneration,
  WorkspaceGenerationError: class extends Error {},
}));
vi.mock("@/lib/services/workspace-orders/commands", () => ({
  createWorkspaceOrder: mocks.createWorkspaceOrder,
  WorkspaceOrderCommandError: class extends Error {},
}));

import { GET, POST } from "./route";

describe("workspace order route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies a request with no verified membership before opening a data client", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    mocks.getServerActorContext.mockResolvedValue(null);

    const response = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/orders`), {
      params: Promise.resolve({ workspaceId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.getServerActorContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.readRecentWorkspaceOrders).not.toHaveBeenCalled();
    expect(mocks.readWorkspaceGeneration).not.toHaveBeenCalled();
  });

  it("uses the shared bounded capability for a verified workspace read", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const actor = { userId: "verified" };
    const supabase = { token: "caller session" };
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.createServerSupabaseClient.mockResolvedValue(supabase);
    mocks.readRecentWorkspaceOrders.mockResolvedValue({ workspaceId, orders: [] });
    mocks.readWorkspaceGeneration.mockResolvedValue(3);

    const response = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/orders`), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orders: [], generation: 3 });
    expect(mocks.readRecentWorkspaceOrders).toHaveBeenCalledWith(actor, supabase, { workspaceId });
    expect(mocks.readWorkspaceGeneration).toHaveBeenCalledWith(actor, supabase, workspaceId);
  });

  it("rejects an unverified order writer before opening a data client", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    mocks.getServerActorContext.mockResolvedValue(null);
    const response = await POST(new Request(`http://localhost/api/workspaces/${workspaceId}/orders`, {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: JSON.stringify({
        expectedGeneration: 1,
        orderNo: "TEST-1", branchId: workspaceId, customerId: workspaceId,
        problemDescription: "Fictional issue", serviceType: "Repair",
      }),
    }), { params: Promise.resolve({ workspaceId }) });
    expect(response.status).toBe(403);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOrder).not.toHaveBeenCalled();
  });
});
