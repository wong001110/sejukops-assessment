import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), runWorkspaceOrdersAgent: vi.fn(),
  readGuestAiBudget: vi.fn(), reserveGuestAiCall: vi.fn(), persistWorkspaceAIRecord: vi.fn(),
}));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.persistWorkspaceAIRecord }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({
  readGuestAiBudget: mocks.readGuestAiBudget, reserveGuestAiCall: mocks.reserveGuestAiCall,
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/ai/runtime/workspace-orders-agent", () => ({
  runWorkspaceOrdersAgent: mocks.runWorkspaceOrdersAgent,
  WorkspaceOrdersAgentError: class extends Error {},
  ProviderAllowanceError: class extends Error {
    constructor(public code: string, public resetAt?: string) { super(code); }
  },
}));
vi.mock("@/lib/services/workspace-orders/listing", () => ({ WorkspaceOrderAccessError: class extends Error {} }));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const authorizedActor = { profileId: "22222222-2222-4222-8222-222222222222", platformRole: "SUPER_ADMIN",
  isAnonymous: false, membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
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
    mocks.readGuestAiBudget.mockResolvedValue({ remaining: 20, resetAt: "2026-09-30T16:00:00Z" });
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: authorizedActor, client: { session: "caller" }, guestVisit: null });
    mocks.runWorkspaceOrdersAgent.mockResolvedValue({
      answer: "Found 1 recent order in this workspace.", orders: [{ id: "safe" }],
      activity: [{ type: "RECENT_ORDERS_READ", orderCount: 1 }],
      providerSteps: 2, usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("resolves actor and caller session before one bounded agent call", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      answer: "Found 1 recent order in this workspace.", orders: [{ id: "safe" }],
      activity: [{ type: "RECENT_ORDERS_READ", orderCount: 1 }],
      traceId: expect.any(String),
    });
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      task: "WORKSPACE_ORDERS", status: "SUCCEEDED",
      execution: expect.objectContaining({ providerSteps: 2, inputTokens: 10, outputTokens: 5 }),
    }), authorizedActor.profileId);
    expect(mocks.runWorkspaceOrdersAgent).toHaveBeenCalledWith(
      authorizedActor, { session: "caller" },
      { workspaceId, question: "Show recent orders", focusOrderId: undefined },
      { abortSignal: expect.any(AbortSignal), beforeProviderCall: undefined },
    );
  });

  it("passes only a validated selected-order ID to the actor-scoped runtime", async () => {
    const focusOrderId = "33333333-3333-4333-8333-333333333333";
    expect((await POST(request("http://localhost", { question: "Review this order", focusOrderId: "invalid" }), context)).status).toBe(400);
    expect(mocks.runWorkspaceOrdersAgent).not.toHaveBeenCalled();
    expect((await POST(request("http://localhost", { question: "Review this order", focusOrderId }), context)).status).toBe(200);
    expect(mocks.runWorkspaceOrdersAgent).toHaveBeenCalledWith(
      authorizedActor, { session: "caller" },
      { workspaceId, question: "Review this order", focusOrderId },
      { abortSignal: expect.any(AbortSignal), beforeProviderCall: undefined },
    );
  });

  it("denies cross-origin and unverified actors before provider access", async () => {
    expect((await POST(request("https://evil.example"), context)).status).toBe(403);
    expect(mocks.getWorkspaceRequestContext).not.toHaveBeenCalled();
    mocks.getWorkspaceRequestContext.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.getWorkspaceRequestContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.runWorkspaceOrdersAgent).not.toHaveBeenCalled();
    expect(mocks.persistWorkspaceAIRecord).not.toHaveBeenCalled();
  });

  it("denies an anonymous Demo actor without a Guest visit", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({
      actor: { ...authorizedActor, isAnonymous: true, membership: { workspaceId, kind: "DEMO", role: "ADMIN" } },
      client: { session: "anonymous" }, guestVisit: null,
    });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.runWorkspaceOrdersAgent).not.toHaveBeenCalled();
  });

  it("allows authenticated Demo members without the retired per-user budget", async () => {
    const actor = { ...authorizedActor, membership: { ...authorizedActor.membership, kind: "DEMO" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: { session: "permanent" }, guestVisit: null });
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.runWorkspaceOrdersAgent).toHaveBeenCalledOnce();
    expect(mocks.reserveGuestAiCall).not.toHaveBeenCalled();
  });

  it("rejects malformed input and returns a manual fallback on provider failure", async () => {
    expect((await POST(request("http://localhost", { question: "x", role: "ADMIN" }), context)).status).toBe(400);
    mocks.runWorkspaceOrdersAgent.mockRejectedValue(new Error("provider key and raw output must stay private"));
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("provider key");
    expect(body).not.toHaveProperty("activity");
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED", errorCode: "WORKSPACE_AGENT_ERROR",
    }), authorizedActor.profileId);
  });

  it("reserves the shared Guest AI allowance immediately before each provider call", async () => {
    const visit = { id: "guest-visit", workspaceId, demoGeneration: 3 };
    const actor = { ...authorizedActor, isAnonymous: true, platformRole: "USER", membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: { session: "server principal" }, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: true, resetAt: "2026-09-30T16:00:00Z" });
    mocks.runWorkspaceOrdersAgent.mockImplementation(async (_actor, _client, _input, options) => {
      await options.beforeProviderCall();
      await options.beforeProviderCall();
      return { answer: "Recent orders", orders: [] };
    });

    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.reserveGuestAiCall).toHaveBeenCalledTimes(2);
    expect(mocks.reserveGuestAiCall).toHaveBeenCalledWith(visit);
  });

  it("stops a Guest provider call when the shared allowance is exhausted", async () => {
    const visit = { id: "guest-visit", workspaceId, demoGeneration: 3 };
    const actor = { ...authorizedActor, isAnonymous: true, platformRole: "USER", membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: { session: "server principal" }, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: false, resetAt: "2026-09-30T16:00:00Z" });
    mocks.runWorkspaceOrdersAgent.mockImplementation(async (_actor, _client, _input, options) => {
      await options.beforeProviderCall();
      throw new Error("Provider must not run");
    });

    const response = await POST(request(), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ resetAt: "2026-09-30T16:00:00Z" });
    expect(mocks.reserveGuestAiCall).toHaveBeenCalledOnce();
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      status: "CONTROLLED", errorCode: "GUEST_AI_EXHAUSTED",
      execution: expect.objectContaining({ guestVisitId: visit.id }),
    }), actor.profileId);
  });

  it("reports an already exhausted Guest allowance before provider resolution", async () => {
    const visit = { id: "guest-visit", workspaceId, demoGeneration: 3 };
    const actor = { ...authorizedActor, isAnonymous: true, platformRole: "USER",
      membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.readGuestAiBudget.mockResolvedValue({ remaining: 0, resetAt: "2026-09-30T16:00:00Z" });
    const response = await POST(request(), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ resetAt: "2026-09-30T16:00:00Z" });
    expect(mocks.runWorkspaceOrdersAgent).not.toHaveBeenCalled();
    expect(mocks.reserveGuestAiCall).not.toHaveBeenCalled();
  });
});
