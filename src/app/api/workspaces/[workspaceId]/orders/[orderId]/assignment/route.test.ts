import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(),
  assignWorkspaceOrder: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-request-context", () => ({
  getWorkspaceRequestContext: mocks.getWorkspaceRequestContext,
}));
vi.mock("@/lib/services/workspace-orders/commands", () => ({
  assignWorkspaceOrder: mocks.assignWorkspaceOrder,
  WorkspaceOrderCommandError: class extends Error {},
}));

import { POST } from "./route";

describe("workspace order assignment route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies an unverified actor before opening a data client", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const orderId = "22222222-2222-4222-8222-222222222222";
    mocks.getWorkspaceRequestContext.mockResolvedValue(null);
    const response = await POST(new Request(`http://localhost/api/workspaces/${workspaceId}/orders/${orderId}/assignment`, {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: JSON.stringify({
        expectedGeneration: 1,
        technicianId: "33333333-3333-4333-8333-333333333333",
        expectedUpdatedAt: "2026-09-28T12:00:00Z",
        scheduledAt: null,
      }),
    }), { params: Promise.resolve({ workspaceId, orderId }) });
    expect(response.status).toBe(403);
    expect(mocks.getWorkspaceRequestContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.assignWorkspaceOrder).not.toHaveBeenCalled();
  });

  it("passes the resolved Guest actor and principal client to assignment", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const orderId = "22222222-2222-4222-8222-222222222222";
    const actor = { isAnonymous: true, membership: { workspaceId, kind: "DEMO", role: "MANAGER" } };
    const client = { session: "server-held Demo principal" };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client, guestVisit: { id: "guest-visit" } });
    mocks.assignWorkspaceOrder.mockResolvedValue({ id: orderId });

    const response = await POST(new Request(`http://localhost/api/workspaces/${workspaceId}/orders/${orderId}/assignment`, {
      method: "POST", headers: { origin: "http://localhost" },
      body: JSON.stringify({ expectedGeneration: 1,
        technicianId: "33333333-3333-4333-8333-333333333333",
        expectedUpdatedAt: "2026-09-28T12:00:00Z", scheduledAt: null }),
    }), { params: Promise.resolve({ workspaceId, orderId }) });

    expect(response.status).toBe(200);
    expect(mocks.assignWorkspaceOrder).toHaveBeenCalledWith(actor, client, {
      workspaceId, orderId, expectedGeneration: 1,
      technicianId: "33333333-3333-4333-8333-333333333333",
      expectedUpdatedAt: "2026-09-28T12:00:00Z", scheduledAt: null,
    });
  });
});
