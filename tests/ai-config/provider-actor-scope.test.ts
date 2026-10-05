import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), getWorkspaceRequestContext: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://example.supabase.co", anonKey: "test-anon-key" }),
}));

import { resolveAIProviderForActorTask } from "@/lib/services/ai-config/service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor: ActorContext = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "DEMO", role: "ADMIN" },
};
const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("AI provider actor scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    mocks.createClient.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    });
  });
  afterEach(() => {
    if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
  });

  it("accepts a server-verified Guest request context up to provider selection", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: { id: "visit" } });
    await expect(resolveAIProviderForActorTask(actor, "OPERATIONS_QUERY")).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
    });
    expect(mocks.getWorkspaceRequestContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });

  it("denies a missing or substituted role before reading provider credentials", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce(null).mockResolvedValueOnce({
      actor: { ...actor, membership: { ...actor.membership, role: "MANAGER" } },
      client: {}, guestVisit: { id: "visit" },
    });
    await expect(resolveAIProviderForActorTask(actor, "OPERATIONS_QUERY")).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    await expect(resolveAIProviderForActorTask(actor, "OPERATIONS_QUERY")).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("limits technician provider access to knowledge reads and operational insight", async () => {
    const technician: ActorContext = { ...actor, membership: { workspaceId, kind: "DEMO", role: "TECHNICIAN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: technician, client: {}, guestVisit: { id: "visit" } });
    await expect(resolveAIProviderForActorTask(technician, "OPERATIONS_QUERY")).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    await expect(resolveAIProviderForActorTask(technician, "OPERATIONS_QUERY", "TEXT", "KNOWLEDGE_READ")).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    mocks.createClient.mockClear();
    await expect(resolveAIProviderForActorTask(technician, "OPERATIONAL_INSIGHT")).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    mocks.createClient.mockClear();
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: { ...technician, preview: { readOnly: true, effectiveEmployeeProfileId: actor.profileId } } });
    await expect(resolveAIProviderForActorTask(technician, "OPERATIONS_QUERY", "TEXT", "KNOWLEDGE_READ")).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
