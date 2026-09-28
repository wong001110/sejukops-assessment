import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resetDemoWorkspace: vi.fn() }));
vi.mock("@/lib/services/demo-reset/service", () => ({ resetDemoWorkspace: mocks.resetDemoWorkspace }));

import { POST } from "./route";

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
});
