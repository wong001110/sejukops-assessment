import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(),
  readRecentWorkspaceOrders: vi.fn(),
  readWorkspaceGeneration: vi.fn(),
  createWorkspaceOrder: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

vi.mock("@/lib/auth/workspace-request-context", () => ({
  getWorkspaceRequestContext: mocks.getWorkspaceRequestContext,
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
    mocks.getWorkspaceRequestContext.mockResolvedValue(null);

    const response = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/orders`), {
      params: Promise.resolve({ workspaceId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.getWorkspaceRequestContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.readRecentWorkspaceOrders).not.toHaveBeenCalled();
    expect(mocks.readWorkspaceGeneration).not.toHaveBeenCalled();
  });

  it("uses the shared bounded capability for a verified workspace read", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const actor = { userId: "verified" };
    const supabase = { token: "caller session" };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: supabase, guestVisit: null });
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
    mocks.getWorkspaceRequestContext.mockResolvedValue(null);
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
    expect(mocks.getWorkspaceRequestContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.createWorkspaceOrder).not.toHaveBeenCalled();
  });

  it("passes a server-resolved Guest actor and client to the shared order capability", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const actor = { isAnonymous: true, membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    const client = { token: "server-held Demo principal" };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client, guestVisit: { id: "visit" } });
    mocks.readRecentWorkspaceOrders.mockResolvedValue({ workspaceId, orders: [] });
    mocks.readWorkspaceGeneration.mockResolvedValue(3);

    const response = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/orders`), {
      params: Promise.resolve({ workspaceId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.readRecentWorkspaceOrders).toHaveBeenCalledWith(actor, client, { workspaceId });
    expect(mocks.readWorkspaceGeneration).toHaveBeenCalledWith(actor, client, workspaceId);
  });

  it("binds a Guest create to the validated visit bearer", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const visitId = "22222222-2222-4222-8222-222222222222";
    const token = "A".repeat(43);
    mocks.cookies.mockResolvedValue({ get: () => ({ value: token }) });
    mocks.getWorkspaceRequestContext.mockResolvedValue({
      actor: { membership: { workspaceId, kind: "DEMO", role: "ADMIN" } },
      client: { session: "fixed Demo principal" }, guestVisit: { id: visitId },
    });
    mocks.createWorkspaceOrder.mockResolvedValue({ id: "created" });
    const request = () => new Request(`http://localhost/api/workspaces/${workspaceId}/orders`, {
      method: "POST", headers: { origin: "http://localhost" },
      body: JSON.stringify({ expectedGeneration: 2, orderNo: "DEMO-1",
        branchId: workspaceId, customerId: workspaceId,
        problemDescription: "Fictional issue", serviceType: "Repair" }),
    });
    expect((await POST(request(), { params: Promise.resolve({ workspaceId }) })).status).toBe(201);
    expect(mocks.createWorkspaceOrder).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ workspaceId }), { visitId, tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect((await POST(request(), { params: Promise.resolve({ workspaceId }) })).status).toBe(403);
    expect(mocks.createWorkspaceOrder).toHaveBeenCalledTimes(1);
  });
});
