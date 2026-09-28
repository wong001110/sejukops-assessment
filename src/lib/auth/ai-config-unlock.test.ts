import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "./actor-policy";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  cookieValues: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieValues.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => mocks.cookieValues.set(name, value),
  }),
}));
vi.mock("@/lib/auth/server-actor", () => ({
  getServerActorContext: mocks.getServerActorContext,
}));

import {
  assertAIConfigUnlocked,
  unlockAIConfig,
} from "./ai-config-unlock";

const previousPassword = process.env.AI_CONFIG_ADMIN_PASSWORD;
const previousSecret = process.env.AI_CONFIG_SESSION_SECRET;
const password = "a-long-test-password";
const superAdminA: ActorContext = {
  authUserId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000011",
  isAnonymous: false,
  platformRole: "SUPER_ADMIN",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieValues.clear();
  process.env.AI_CONFIG_ADMIN_PASSWORD = password;
  process.env.AI_CONFIG_SESSION_SECRET = "test-session-secret";
  mocks.getServerActorContext.mockResolvedValue(superAdminA);
});

afterAll(() => {
  if (previousPassword === undefined) delete process.env.AI_CONFIG_ADMIN_PASSWORD;
  else process.env.AI_CONFIG_ADMIN_PASSWORD = previousPassword;
  if (previousSecret === undefined) delete process.env.AI_CONFIG_SESSION_SECRET;
  else process.env.AI_CONFIG_SESSION_SECRET = previousSecret;
});

describe("platform configuration unlock", () => {
  it("binds the signed unlock to the verified user and profile", async () => {
    await unlockAIConfig(password);
    await expect(assertAIConfigUnlocked()).resolves.toBeUndefined();

    mocks.getServerActorContext.mockResolvedValue({
      ...superAdminA,
      authUserId: "00000000-0000-4000-8000-000000000002",
      profileId: "00000000-0000-4000-8000-000000000012",
    });
    await expect(assertAIConfigUnlocked()).rejects.toMatchObject({
      code: "AI_CONFIG_UNLOCK_REQUIRED",
    });
  });

  it("never treats a signed unlock as platform authority", async () => {
    await unlockAIConfig(password);
    mocks.getServerActorContext.mockResolvedValue({
      ...superAdminA,
      platformRole: "USER",
    });

    await expect(assertAIConfigUnlocked()).rejects.toMatchObject({
      code: "AI_CONFIG_PERMISSION_DENIED",
    });
  });
});
