import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://test.supabase.co", anonKey: "public" }),
}));

import { POST } from "./route";

function request(persona = "ADMIN", origin?: string) {
  return new NextRequest("https://example.com/api/demo/entry", {
    method: "POST",
    headers: {
      ...(origin ? { origin } : {}),
      "x-vercel-forwarded-for": "1.2.3.4",
    },
    body: new URLSearchParams({ persona, "cf-turnstile-response": "token" }),
  });
}

describe("public Demo entry", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects cross-origin and missing-origin submissions before any Auth call", async () => {
    expect((await POST(request())).status).toBe(303);
    expect((await POST(request("ADMIN", "https://evil.example.com"))).headers.get("location"))
      .toContain("error=denied");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("fails closed until hosted Supabase CAPTCHA is explicitly confirmed", async () => {
    const old = process.env.DEMO_SUPABASE_CAPTCHA_ENABLED;
    delete process.env.DEMO_SUPABASE_CAPTCHA_ENABLED;
    try {
      const response = await POST(request("ADMIN", "https://example.com"));
      expect(response.headers.get("location")).toContain("error=unavailable");
      expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    } finally {
      if (old !== undefined) process.env.DEMO_SUPABASE_CAPTCHA_ENABLED = old;
    }
  });

  it("passes the one-use CAPTCHA token to Supabase Auth after quota reservation", async () => {
    vi.stubEnv("DEMO_SUPABASE_CAPTCHA_ENABLED", "true");
    vi.stubEnv("DEMO_TURNSTILE_SITE_KEY", "public-site-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-key");
    const order: string[] = [];
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      order.push(name);
      return { data: name === "demo_entry_reserve" ? true : "00000000-0000-4000-8000-000000000001", error: null };
    });
    mocks.createClient.mockReturnValue({ rpc, auth: { admin: { deleteUser: vi.fn() } } });
    const signInAnonymously = vi.fn().mockImplementation(async () => {
      order.push("signInAnonymously");
      return { data: { user: { id: "visitor", is_anonymous: true } }, error: null };
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }), signInAnonymously },
    });

    const response = await POST(request("TECHNICIAN", "https://example.com"));

    expect(response.status).toBe(303);
    expect(signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: "token" } });
    expect(order).toEqual(["demo_entry_reserve", "signInAnonymously", "demo_provision_user"]);
    expect(rpc).toHaveBeenLastCalledWith("demo_provision_user", {
      p_auth_user_id: "visitor", p_role: "TECHNICIAN",
    });
  });
});
