import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));

import { getCurrentDemoIdentity, requireRole } from "./server";

describe("retired mock identity", () => {
  it("provides no role to legacy business services or pages", async () => {
    await expect(getCurrentDemoIdentity()).resolves.toBeUndefined();
    await expect(requireRole("ADMIN")).rejects.toThrow("REDIRECT:/");
  });
});
