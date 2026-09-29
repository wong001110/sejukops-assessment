import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), reserveGuestAiCall: vi.fn(),
  isSameOriginRequest: vi.fn(), prepareWorkspaceOrderDraft: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ reserveGuestAiCall: mocks.reserveGuestAiCall }));
vi.mock("@/lib/auth/demo-entry", () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));
vi.mock("@/lib/services/workspace-order-intake/draft", () => ({
  prepareWorkspaceOrderDraft: mocks.prepareWorkspaceOrderDraft,
  WorkspaceOrderIntakeError: class extends Error {
    constructor(readonly code: string, readonly resetAt?: string) { super(code); }
  },
}));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "DEMO", role: "ADMIN" },
};
const visit = { id: "44444444-4444-4444-8444-444444444444", workspaceId, demoGeneration: 2 };
const context = { params: Promise.resolve({ workspaceId }) };
function upload(type = "text/plain") {
  const form = new FormData();
  form.set("file", new Blob(["Customer: A"], { type }), "service.txt");
  return new Request("https://example.test/api/workspaces/order-intake/draft", { method: "POST", body: form });
}

describe("order intake draft route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: null });
    mocks.prepareWorkspaceOrderDraft.mockResolvedValue({ draft: {}, generation: 2 });
  });

  it("refuses a missing or wrong-role workspace context before extraction", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce(null);
    expect((await POST(upload(), context)).status).toBe(403);
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce({ actor: {
      ...actor, membership: { ...actor.membership, role: "TECHNICIAN" },
    }, client: {}, guestVisit: null });
    expect((await POST(upload(), context)).status).toBe(403);
    expect(mocks.prepareWorkspaceOrderDraft).not.toHaveBeenCalled();
  });

  it("rejects unsupported files and accepts bounded Owner text for review only", async () => {
    expect((await POST(upload("image/png"), context)).status).toBe(400);
    const response = await POST(upload(), context);
    expect(response.status).toBe(200);
    expect(mocks.prepareWorkspaceOrderDraft).toHaveBeenCalledOnce();
    expect(mocks.prepareWorkspaceOrderDraft.mock.calls[0][3].beforeProviderCall).toBeUndefined();
    expect(mocks.reserveGuestAiCall).not.toHaveBeenCalled();
  });

  it("reserves the shared allowance for a verified Guest visit before extraction", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: true, resetAt: "2026-09-30T16:00:00Z" });
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      return { draft: {}, generation: 2 };
    });
    expect((await POST(upload(), context)).status).toBe(200);
    expect(mocks.reserveGuestAiCall).toHaveBeenCalledExactlyOnceWith(visit);
  });

  it("returns exhaustion without a draft and keeps manual Demo actions available", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: false, resetAt: "2026-09-30T16:00:00Z" });
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      return { draft: {}, generation: 2 };
    });
    const response = await POST(upload(), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("allowance") });
  });

  it("fails closed when the workspace resolver or Guest allowance is unavailable", async () => {
    mocks.getWorkspaceRequestContext.mockRejectedValueOnce(new Error("Auth unavailable"));
    expect((await POST(upload(), context)).status).toBe(503);
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue(null);
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      return { draft: {}, generation: 2 };
    });
    expect((await POST(upload(), context)).status).toBe(503);
  });
});
