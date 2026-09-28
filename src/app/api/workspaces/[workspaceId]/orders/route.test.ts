import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  listWorkspaceOrders: vi.fn(),
}));

vi.mock("@/lib/auth/server-actor", () => ({
  getServerActorContext: mocks.getServerActorContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/services/workspace-orders/listing", () => ({
  listWorkspaceOrders: mocks.listWorkspaceOrders,
  WorkspaceOrderAccessError: class extends Error {},
}));

import { GET } from "./route";

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
    expect(mocks.listWorkspaceOrders).not.toHaveBeenCalled();
  });
});
