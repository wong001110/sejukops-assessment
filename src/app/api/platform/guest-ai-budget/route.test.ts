import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({
  readGuestAiBudgetForAdmin: mocks.read,
  setGuestAiDailyLimit: mocks.set,
}));

import { GET, POST } from "./route";

const status = { used: 3, limit: 20, remaining: 17, resetAt: "2026-09-30T00:00:00+08:00" };

function post(origin: string | null, body: string) {
  return new NextRequest("https://example.com/api/platform/guest-ai-budget", {
    method: "POST",
    headers: origin ? { origin } : {},
    body,
  });
}

describe("platform Guest AI budget API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the safe allowance snapshot without caching", async () => {
    mocks.read.mockResolvedValue(status);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(status);
  });

  it("fails closed when the platform actor is denied or budget is unavailable", async () => {
    mocks.read.mockRejectedValueOnce({ code: "PERMISSION_DENIED" }).mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(403);
    expect((await GET()).status).toBe(503);
  });

  it("rejects cross-origin and missing-origin writes before touching the helper", async () => {
    expect((await POST(post("https://other.example", '{"limit":25}'))).status).toBe(403);
    expect((await POST(post(null, '{"limit":25}'))).status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each(["not-json", "null", "[]", '{"limit":0}', '{"limit":1001}', '{"limit":1.5}', '{"limit":"25"}'])(
    "rejects invalid input %s",
    async (body) => {
      expect((await POST(post("https://example.com", body))).status).toBe(400);
      expect(mocks.set).not.toHaveBeenCalled();
    },
  );

  it("changes the limit only through the gated helper and hides failures", async () => {
    mocks.set.mockResolvedValueOnce(25).mockRejectedValueOnce({ code: "PERMISSION_DENIED" }).mockRejectedValueOnce(new Error("private database detail"));
    const saved = await POST(post("https://example.com", '{"limit":25}'));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ limit: 25 });
    expect(mocks.set).toHaveBeenCalledWith(25);
    expect((await POST(post("https://example.com", '{"limit":25}'))).status).toBe(403);
    const failed = await POST(post("https://example.com", '{"limit":25}'));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("private database detail");
  });
});
