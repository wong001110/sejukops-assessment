import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createGuestServiceClient: vi.fn(),
  issueGuestVisit: vi.fn(),
  pruneExpiredGuestVisits: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/auth/guest-session", () => ({
  createGuestServiceClient: mocks.createGuestServiceClient,
  issueGuestVisit: mocks.issueGuestVisit,
  pruneExpiredGuestVisits: mocks.pruneExpiredGuestVisits,
  GUEST_COOKIE_NAME: "sejuk_guest_visit",
  GUEST_VISIT_SECONDS: 7200,
}));

import { POST } from "./route";

function request(persona = "ADMIN", origin = "https://example.com") {
  return new NextRequest("https://example.com/api/demo/entry", {
    method: "POST",
    headers: { origin },
    body: new URLSearchParams({ persona }),
  });
}

describe("public Guest entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });
    mocks.createGuestServiceClient.mockReturnValue({});
    mocks.issueGuestVisit.mockResolvedValue({ token: "opaque", visit: { id: "visit", workspaceId: "demo" } });
    mocks.pruneExpiredGuestVisits.mockResolvedValue(undefined);
  });

  it("denies forged origin before any session or database access", async () => {
    expect((await POST(request("ADMIN", "https://evil.example.com"))).headers.get("location"))
      .toContain("error=denied");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.createGuestServiceClient).not.toHaveBeenCalled();
  });

  it("starts in Admin and opens Demo; a submitted persona cannot select the entry role", async () => {
    const response = await POST(request("TECHNICIAN"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.com/workspaces/demo/orders");
    expect(mocks.issueGuestVisit).toHaveBeenCalledWith({}, "ADMIN");
    expect(mocks.pruneExpiredGuestVisits).toHaveBeenCalledWith({});
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sejuk_guest_visit=opaque");
    expect(cookie).toContain("Max-Age=7200");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Secure");
  });

  it("refuses a permanent Owner session", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }) },
    });
    expect((await POST(request())).headers.get("location")).toContain("error=signed-in");
    expect(mocks.issueGuestVisit).not.toHaveBeenCalled();
  });

  it("fails closed when service storage is unavailable", async () => {
    mocks.createGuestServiceClient.mockReturnValue(null);
    expect((await POST(request())).headers.get("location")).toContain("error=unavailable");
    expect(mocks.issueGuestVisit).not.toHaveBeenCalled();
  });
});
