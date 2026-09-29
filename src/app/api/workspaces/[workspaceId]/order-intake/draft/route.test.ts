import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(),
  isSameOriginRequest: vi.fn(), reserveDemoAiCall: vi.fn(),
  prepareWorkspaceOrderDraft: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/auth/demo-entry", () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));
vi.mock("@/lib/ai/runtime/demo-ai-budget", () => ({ reserveDemoAiCall: mocks.reserveDemoAiCall }));
vi.mock("@/lib/services/workspace-order-intake/draft", () => ({
  prepareWorkspaceOrderDraft: mocks.prepareWorkspaceOrderDraft,
  WorkspaceOrderIntakeError: class extends Error {},
}));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  platformRole: "USER", isAnonymous: true,
  membership: { workspaceId, kind: "DEMO", role: "ADMIN" },
};
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
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.reserveDemoAiCall.mockResolvedValue(true);
    mocks.createServerSupabaseClient.mockResolvedValue({});
    mocks.prepareWorkspaceOrderDraft.mockResolvedValue({ draft: {}, generation: 2 });
  });
  it("refuses wrong role and over-quota Demo before provider extraction", async () => {
    mocks.getServerActorContext.mockResolvedValueOnce({ ...actor,
      membership: { ...actor.membership, role: "TECHNICIAN" } });
    expect((await POST(upload(), context)).status).toBe(403);
    expect(mocks.prepareWorkspaceOrderDraft).not.toHaveBeenCalled();
    mocks.reserveDemoAiCall.mockResolvedValue(false);
    expect((await POST(upload(), context)).status).toBe(429);
    expect(mocks.prepareWorkspaceOrderDraft).not.toHaveBeenCalled();
  });
  it("rejects unsupported files and accepts bounded text for review only", async () => {
    expect((await POST(upload("image/png"), context)).status).toBe(400);
    expect(mocks.reserveDemoAiCall).not.toHaveBeenCalled();
    const response = await POST(upload(), context);
    expect(response.status).toBe(200);
    expect(mocks.prepareWorkspaceOrderDraft).toHaveBeenCalledOnce();
  });
});
