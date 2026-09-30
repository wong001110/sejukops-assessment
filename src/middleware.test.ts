import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));

vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://example.supabase.co", anonKey: "public-key" }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { middleware } from "./middleware";

describe("Supabase session middleware", () => {
  it("passes refreshed cookies to the request and browser without caching them", async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getClaims: async () => {
          options.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { httpOnly: true } }]);
          return { data: { claims: { sub: "user" } }, error: null };
        },
      },
    }));
    const request = new NextRequest("http://localhost/owner");

    const response = await middleware(request);

    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
