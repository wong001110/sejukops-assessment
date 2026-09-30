import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readDemoResetStatus: vi.fn(), resetDemoWorkspace: vi.fn() }));
vi.mock("@/lib/services/demo-reset/service", () => ({
  readDemoResetStatus: mocks.readDemoResetStatus, resetDemoWorkspace: mocks.resetDemoWorkspace,
}));

import { GET, POST } from "./route";

function request(origin: string | null, body: unknown) {
  return new NextRequest("https://example.com/api/platform/demo/reset", {
    method: "POST",
    headers: origin ? { origin } : {},
    body: JSON.stringify(body),
  });
}

describe("Demo reset route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects cross-origin requests before reset", async () => {
    expect((await POST(request("https://other.example", { confirm: "RESET DEMO", expectedGeneration: 1 }))).status).toBe(403);
    expect(mocks.resetDemoWorkspace).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation and a safe generation", async () => {
    expect((await POST(request("https://example.com", { expectedGeneration: 1 }))).status).toBe(400);
    expect((await POST(request("https://example.com", { confirm: "RESET DEMO", expectedGeneration: 0 }))).status).toBe(400);
    expect(mocks.resetDemoWorkspace).not.toHaveBeenCalled();
  });

  it("does not expose reset errors", async () => {
    mocks.resetDemoWorkspace.mockRejectedValue({ code: "PERMISSION_DENIED" });
    expect((await POST(request("https://example.com", { confirm: "RESET DEMO", expectedGeneration: 1 }))).status).toBe(403);
  });

  it("returns private Demo status only after the service gate", async () => {
    mocks.readDemoResetStatus.mockResolvedValue({ generation: 2, orderCount: 4 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ generation: 2, orderCount: 4 });
    mocks.readDemoResetStatus.mockRejectedValue({ code: "PERMISSION_DENIED" });
    expect((await GET()).status).toBe(403);
  });
});
