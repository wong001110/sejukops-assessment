import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createPlatformDataContext: vi.fn() }));
vi.mock("@/lib/supabase/platform-server", () => ({ createPlatformDataContext: mocks.createPlatformDataContext }));

import { readDemoResetStatus, resetDemoWorkspace } from "./service";

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

  it("reads only the active Demo generation and its order count after the platform gate", async () => {
    const workspaceQuery = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
    workspaceQuery.select.mockReturnValue(workspaceQuery);
    workspaceQuery.eq.mockReturnValue(workspaceQuery);
    workspaceQuery.single.mockResolvedValue({ data: { id: "demo-id", generation: 2 }, error: null });
    const ordersQuery = { select: vi.fn(), eq: vi.fn() };
    ordersQuery.select.mockReturnValue(ordersQuery);
    ordersQuery.eq.mockResolvedValue({ count: 4, error: null });
    const from = vi.fn((table: string) => table === "workspaces" ? workspaceQuery : ordersQuery);
    mocks.createPlatformDataContext.mockResolvedValue({ supabase: { from } });

    expect(await readDemoResetStatus()).toEqual({ generation: 2, orderCount: 4 });
    expect(mocks.createPlatformDataContext).toHaveBeenCalledWith("ai_config:view");
    expect(workspaceQuery.eq).toHaveBeenCalledWith("kind", "DEMO");
    expect(workspaceQuery.eq).toHaveBeenCalledWith("active", true);
    expect(ordersQuery.eq).toHaveBeenCalledWith("workspace_id", "demo-id");
  });

  it("does not read Demo data after a denied platform gate", async () => {
    mocks.createPlatformDataContext.mockRejectedValue({ code: "PERMISSION_DENIED" });
    await expect(readDemoResetStatus()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
