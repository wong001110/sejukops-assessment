import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://test.supabase.co" }),
}));

import { reserveDemoAiCall } from "./demo-ai-budget";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  isAnonymous: true,
  platformRole: "USER" as const,
  membership: { workspaceId, kind: "DEMO" as const, role: "ADMIN" as const },
};

describe("Demo AI reservation", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-secret");
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("rejects missing proxy IP and non-Demo identity before service access", async () => {
    expect(await reserveDemoAiCall(actor, workspaceId, new Headers())).toBe(false);
    expect(await reserveDemoAiCall({ ...actor, membership: { ...actor.membership, kind: "OWNER" } }, workspaceId,
      new Headers({ "x-vercel-forwarded-for": "203.0.113.1" }))).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("reserves with a digest and fails closed on quota or RPC errors", async () => {
    const headers = new Headers({ "x-vercel-forwarded-for": "203.0.113.1" });
    expect(await reserveDemoAiCall(actor, workspaceId, headers)).toBe(true);
    expect(await reserveDemoAiCall({ ...actor, isAnonymous: false }, workspaceId, headers)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("demo_ai_reserve", {
      p_auth_user_id: actor.authUserId, p_workspace_id: workspaceId,
      p_ip_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await reserveDemoAiCall(actor, workspaceId, headers)).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "failure" } });
    expect(await reserveDemoAiCall(actor, workspaceId, headers)).toBe(false);
  });
});
