import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGuestServiceClient: vi.fn(),
  resolveGuestVisit: vi.fn(),
  changeGuestPersona: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/auth/guest-session", () => ({
  createGuestServiceClient: mocks.createGuestServiceClient,
  resolveGuestVisit: mocks.resolveGuestVisit,
  changeGuestPersona: mocks.changeGuestPersona,
  GUEST_COOKIE_NAME: "sejuk_guest_visit",
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));

import { guestPersonaReturnUrl } from "@/lib/auth/guest-persona-return";
import { POST } from "./route";

function request(persona: string, cookie = "sejuk_guest_visit=opaque", origin = "https://example.com", referer?: string) {
  return new NextRequest("https://example.com/api/demo/persona", {
    method: "POST",
    headers: { origin, cookie, ...(referer ? { referer } : {}) },
    body: new URLSearchParams({ persona }),
  });
}

describe("Guest persona route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGuestServiceClient.mockReturnValue({});
    mocks.resolveGuestVisit.mockResolvedValue({ id: "visit", persona: "ADMIN", workspaceId: "demo" });
    mocks.changeGuestPersona.mockResolvedValue(true);
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });
  });

  it("denies missing, forged, or expired visit before a role change", async () => {
    expect((await POST(request("MANAGER", ""))).status).toBe(403);
    mocks.resolveGuestVisit.mockResolvedValue(null);
    expect((await POST(request("MANAGER"))).status).toBe(403);
    expect(mocks.changeGuestPersona).not.toHaveBeenCalled();
  });

  it("denies cross-origin, platform persona and a simultaneous Owner session", async () => {
    expect((await POST(request("MANAGER", "sejuk_guest_visit=opaque", "https://evil.example.com"))).status).toBe(403);
    expect((await POST(request("SUPER_ADMIN"))).status).toBe(400);
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }) },
    });
    expect((await POST(request("MANAGER"))).status).toBe(403);
    expect(mocks.changeGuestPersona).not.toHaveBeenCalled();
  });

  it("updates only the server-side visit persona", async () => {
    const response = await POST(request("TECHNICIAN"));
    expect(response.status).toBe(303);
    expect(mocks.changeGuestPersona).toHaveBeenCalledWith({}, "opaque", expect.objectContaining({ id: "visit" }), "TECHNICIAN");
    expect(response.headers.get("location")).toBe("https://example.com/workspaces/demo/orders");
  });

  it("keeps a visible order selected after switching perspective", async () => {
    const orderId = "a51f2da2-c1a0-4314-8644-143ca4d4af1e";
    const referer = `https://example.com/workspaces/demo/orders?orderId=${orderId}`;
    expect(guestPersonaReturnUrl("https://example.com", referer, "demo", "MANAGER").href)
      .toBe(referer);
    const submission = request("MANAGER", "sejuk_guest_visit=opaque", "https://example.com", referer);
    expect(submission.headers.get("referer")).toBe(referer);
    const response = await POST(submission);
    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe(`https://example.com/workspaces/demo/orders?orderId=${orderId}`);
  });

  it("preserves shared pages but does not send Technician to an unavailable Agent page", () => {
    expect(guestPersonaReturnUrl("https://example.com",
      "https://example.com/workspaces/demo/knowledge?ignored=1", "demo", "TECHNICIAN").href)
      .toBe("https://example.com/workspaces/demo/knowledge");
    expect(guestPersonaReturnUrl("https://example.com",
      "https://example.com/workspaces/demo/agent?orderId=a51f2da2-c1a0-4314-8644-143ca4d4af1e",
      "demo", "TECHNICIAN").href)
      .toBe("https://example.com/workspaces/demo/orders?orderId=a51f2da2-c1a0-4314-8644-143ca4d4af1e");
  });

  it("ignores forged return destinations and malformed order IDs", () => {
    const fallback = "https://example.com/workspaces/demo/orders";
    for (const referer of ["https://evil.example.com/workspaces/demo/orders",
      "https://example.com/workspaces/owner/orders", "https://example.com/workspaces/demo/orders/extra",
      "https://example.com/owner", "not-a-url"]) {
      expect(guestPersonaReturnUrl("https://example.com", referer, "demo", "ADMIN").href).toBe(fallback);
    }
    expect(guestPersonaReturnUrl("https://example.com",
      "https://example.com/workspaces/demo/orders?orderId=../../owner&token=secret", "demo", "ADMIN").href)
      .toBe(fallback);
  });
});
