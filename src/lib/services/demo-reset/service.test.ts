import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createPlatformDataContext: vi.fn() }));
vi.mock("@/lib/supabase/platform-server", () => ({ createPlatformDataContext: mocks.createPlatformDataContext }));

import { resetDemoWorkspace } from "./service";

describe("Demo reset service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid generation before creating a privileged client", async () => {
    await expect(resetDemoWorkspace(0)).rejects.toMatchObject({ code: "INVALID_GENERATION" });
    expect(mocks.createPlatformDataContext).not.toHaveBeenCalled();
  });

  it("passes only the server-resolved actor and observed generation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 4, error: null });
    mocks.createPlatformDataContext.mockResolvedValue({ actor: { authUserId: "server-user" }, supabase: { rpc } });
    expect(await resetDemoWorkspace(3)).toBe(4);
    expect(mocks.createPlatformDataContext).toHaveBeenCalledWith("ai_config:manage");
    expect(rpc).toHaveBeenCalledWith("demo_reset", {
      p_actor_auth_user_id: "server-user", p_expected_generation: 3,
    });
  });

  it("fails closed on an invalid database result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });
    mocks.createPlatformDataContext.mockResolvedValue({ actor: { authUserId: "server-user" }, supabase: { rpc } });
    await expect(resetDemoWorkspace(3)).rejects.toMatchObject({ code: "RESET_FAILED" });
  });
});
