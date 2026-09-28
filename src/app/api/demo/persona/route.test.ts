import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));

import { POST } from "./route";

function request(persona: string) {
  return new NextRequest("https://example.com/api/demo/persona", {
    method: "POST",
    headers: { origin: "https://example.com" },
    body: new URLSearchParams({ persona }),
  });
}

describe("Demo persona route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies a permanent user before any mutation client is created", async () => {
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: false, platformRole: "SUPER_ADMIN" });
    expect((await POST(request("TECHNICIAN"))).status).toBe(403);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects a forged platform role from an anonymous caller", async () => {
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: true, platformRole: "USER" });
    expect((await POST(request("SUPER_ADMIN"))).status).toBe(400);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
