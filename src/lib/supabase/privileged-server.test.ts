import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentDemoIdentity: vi.fn().mockResolvedValue(undefined),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getCurrentDemoIdentity: mocks.getCurrentDemoIdentity,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { createAuthorizedDataContext } from "./privileged-server";

describe("retired assessment service-role gate", () => {
  it.each(["order:view", "order:create", "job:view_assigned"] as const)(
    "rejects %s before creating a privileged client",
    async (permission) => {
      await expect(createAuthorizedDataContext(permission)).rejects.toMatchObject({
        code: "DEMO_SESSION_REQUIRED",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
});
