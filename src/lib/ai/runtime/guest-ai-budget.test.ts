import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), rpc: vi.fn(), createPlatformDataContext: vi.fn(),
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://test.supabase.co" }),
}));
vi.mock("@/lib/supabase/platform-server", () => ({
  createPlatformDataContext: mocks.createPlatformDataContext,
}));

import { readGuestAiBudget, readGuestAiBudgetForAdmin, reserveGuestAiCall, setGuestAiDailyLimit } from "./guest-ai-budget";

const scope = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  demoGeneration: 2,
};
const status = { used: 4, limit: 20, remaining: 16, resetAt: "2026-09-30T00:00:00+08:00" };

describe("global Guest AI allowance service", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: { ...status, allowed: true }, error: null });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ eq: mocks.eq, single: mocks.single });
    mocks.single.mockResolvedValue({ data: { id: scope.workspaceId, generation: scope.demoGeneration }, error: null });
    mocks.createPlatformDataContext.mockResolvedValue({
      actor: { authUserId: "33333333-3333-4333-8333-333333333333" },
      supabase: { rpc: mocks.rpc, from: mocks.from },
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("reserves exactly one call in the validated Demo generation", async () => {
    expect(await reserveGuestAiCall(scope)).toEqual({ ...status, allowed: true });
    expect(mocks.rpc).toHaveBeenCalledWith("guest_ai_budget_reserve", {
      p_visit_id: scope.id,
      p_workspace_id: scope.workspaceId, p_generation: scope.demoGeneration,
    });
    expect(mocks.createClient).toHaveBeenCalledWith("https://test.supabase.co", "test-service-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("fails closed on invalid scope, missing key, denied quota, RPC error or malformed data", async () => {
    expect(await reserveGuestAiCall({ ...scope, id: "client-picked-name" })).toBeNull();
    expect(await reserveGuestAiCall({ ...scope, demoGeneration: 0 })).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await reserveGuestAiCall(scope)).toBeNull();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    mocks.rpc.mockResolvedValueOnce({ data: { ...status, used: 20, remaining: 0, allowed: false }, error: null });
    expect((await reserveGuestAiCall(scope))?.allowed).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect(await reserveGuestAiCall(scope)).toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: { ...status, allowed: "yes" }, error: null });
    expect(await reserveGuestAiCall(scope)).toBeNull();
    mocks.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await reserveGuestAiCall(scope)).toBeNull();
  });

  it("reads shared status without reserving a call", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: status, error: null });
    expect(await readGuestAiBudget(scope)).toEqual(status);
    expect(mocks.rpc).toHaveBeenCalledWith("guest_ai_budget_status", {
      p_visit_id: scope.id,
      p_workspace_id: scope.workspaceId, p_generation: scope.demoGeneration,
    });
  });

  it("lets a freshly gated Super Admin read the global status", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: status, error: null });
    expect(await readGuestAiBudgetForAdmin()).toEqual(status);
    expect(mocks.createPlatformDataContext).toHaveBeenCalledWith("ai_config:view");
    expect(mocks.rpc).toHaveBeenCalledWith("guest_ai_budget_status_admin", {
      p_actor_auth_user_id: "33333333-3333-4333-8333-333333333333",
    });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "missing" } });
    expect(await readGuestAiBudgetForAdmin()).toBeNull();
  });

  it("requires a fresh platform gate and bounded Super Admin update", async () => {
    await expect(setGuestAiDailyLimit(0)).rejects.toThrow(RangeError);
    await expect(setGuestAiDailyLimit(1001)).rejects.toThrow(RangeError);
    expect(mocks.createPlatformDataContext).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: 25, error: null });
    await expect(setGuestAiDailyLimit(25)).resolves.toBe(25);
    expect(mocks.createPlatformDataContext).toHaveBeenCalledWith("ai_config:manage");
    expect(mocks.rpc).toHaveBeenCalledWith("guest_ai_budget_set_limit", {
      p_actor_auth_user_id: "33333333-3333-4333-8333-333333333333", p_daily_limit: 25,
    });
    mocks.createPlatformDataContext.mockRejectedValueOnce(new Error("denied"));
    await expect(setGuestAiDailyLimit(25)).rejects.toThrow("denied");
  });
});
