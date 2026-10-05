import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server-actor", () => ({
  getServerActorContext: mocks.getServerActorContext,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://example.supabase.co", anonKey: "test" }),
}));
import { createPlatformDataContext } from "./platform-server";

const oldServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const demoAdmin: ActorContext = {
  authUserId: "auth-demo",
  profileId: "profile-demo",
  isAnonymous: true,
  platformRole: "USER",
  membership: { workspaceId: "demo", kind: "DEMO", role: "ADMIN" },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

afterAll(() => {
  if (oldServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = oldServiceRoleKey;
});

describe("platform service client gate", () => {
  it("does not create a privileged client for a Demo Admin", async () => {
    mocks.getServerActorContext.mockResolvedValue(demoAdmin);

    await expect(createPlatformDataContext("ai_config:manage")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not create a privileged client for a signed-in workspace Admin", async () => {
    mocks.getServerActorContext.mockResolvedValue({
      ...demoAdmin,
      isAnonymous: false,
    });

    await expect(createPlatformDataContext("diagnostics:view")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("grants platform access without inferring extra business permissions", async () => {
    mocks.getServerActorContext.mockResolvedValue({
      ...demoAdmin,
      isAnonymous: false,
      platformRole: "SUPER_ADMIN",
      membership: { workspaceId: "owner", kind: "OWNER", role: "MANAGER" },
    });

    const context = await createPlatformDataContext("ai_config:view");
    expect(context.actor.membership?.role).toBe("MANAGER");
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });
});
