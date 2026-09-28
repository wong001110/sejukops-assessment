import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(), runWorkspaceOrdersAgent: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/ai/runtime/workspace-orders-agent", () => ({
  runWorkspaceOrdersAgent: mocks.runWorkspaceOrdersAgent,
  WorkspaceOrdersAgentError: class extends Error {},
}));
vi.mock("@/lib/services/workspace-orders/listing", () => ({ WorkspaceOrderAccessError: class extends Error {} }));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const url = `http://localhost/api/workspaces/${workspaceId}/agent/orders`;
const context = { params: Promise.resolve({ workspaceId }) };
function request(origin = "http://localhost", body: unknown = { question: "Show recent orders" }) {
  return new Request(url, { method: "POST", headers: {
    "Content-Type": "application/json", Origin: origin,
  }, body: JSON.stringify(body) });
}

describe("workspace order agent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: false, membership: { workspaceId } });
    mocks.createServerSupabaseClient.mockResolvedValue({ session: "caller" });
    mocks.runWorkspaceOrdersAgent.mockResolvedValue({
      answer: "Found 1 recent order in this workspace.", orders: [{ id: "safe" }],
      providerSteps: 2, usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("resolves actor and caller session before one bounded agent call", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      answer: "Found 1 recent order in this workspace.", orders: [{ id: "safe" }],
    });
    expect(mocks.runWorkspaceOrdersAgent).toHaveBeenCalledWith(
      { isAnonymous: false, membership: { workspaceId } }, { session: "caller" },
      { workspaceId, question: "Show recent orders" }, { abortSignal: expect.any(AbortSignal) },
    );
  });

  it("denies cross-origin and unverified actors before provider access", async () => {
    expect((await POST(request("https://evil.example"), context)).status).toBe(403);
    expect(mocks.getServerActorContext).not.toHaveBeenCalled();
    mocks.getServerActorContext.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.runWorkspaceOrdersAgent).not.toHaveBeenCalled();
  });

  it("holds anonymous Demo calls until a shared budget exists", async () => {
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: true, membership: { workspaceId } });
    expect((await POST(request(), context)).status).toBe(503);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.runWorkspaceOrdersAgent).not.toHaveBeenCalled();
  });

  it("rejects malformed input and returns a manual fallback on provider failure", async () => {
    expect((await POST(request("http://localhost", { question: "x", role: "ADMIN" }), context)).status).toBe(400);
    mocks.runWorkspaceOrdersAgent.mockRejectedValue(new Error("provider key and raw output must stay private"));
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("provider key");
  });
});
