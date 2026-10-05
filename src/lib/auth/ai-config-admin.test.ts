import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "./actor-policy";

const mocks = vi.hoisted(() => ({ getServerActorContext: vi.fn() }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));

import { assertAIConfigAdmin } from "./ai-config-admin";

const superAdmin: ActorContext = {
  authUserId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000011",
  isAnonymous: false,
  platformRole: "SUPER_ADMIN",
};

describe("AI configuration platform gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("permits only a currently resolved platform Super Admin", async () => {
    mocks.getServerActorContext.mockResolvedValue(superAdmin);
    await expect(assertAIConfigAdmin()).resolves.toBeUndefined();
    expect(mocks.getServerActorContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no session", null],
    ["workspace Admin", { ...superAdmin, platformRole: "USER", membership: { workspaceId: "demo", kind: "DEMO", role: "ADMIN" } }],
    ["anonymous identity", { ...superAdmin, isAnonymous: true }],
  ])("denies %s", async (_name, actor) => {
    mocks.getServerActorContext.mockResolvedValue(actor);
    await expect(assertAIConfigAdmin()).rejects.toMatchObject({
      code: "AI_CONFIG_PERMISSION_DENIED",
      status: 403,
    });
  });

  it("checks the current identity again after a prior successful request", async () => {
    mocks.getServerActorContext.mockResolvedValueOnce(superAdmin).mockResolvedValueOnce(null);
    await expect(assertAIConfigAdmin()).resolves.toBeUndefined();
    await expect(assertAIConfigAdmin()).rejects.toMatchObject({ code: "AI_CONFIG_PERMISSION_DENIED" });
  });
});
