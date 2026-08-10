import { describe, expect, it } from "vitest";

import {
  SupabaseConfigurationError,
  getSupabaseConfigStatus,
  getSupabasePublicConfig,
} from "../../src/lib/supabase/config";

describe("Supabase public configuration", () => {
  it("reports every missing public value without crashing unrelated code", () => {
    expect(getSupabaseConfigStatus({})).toEqual({
      configured: false,
      missing: [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ],
    });
  });

  it("throws a stable configuration error only when a client is requested", () => {
    expect(() => getSupabasePublicConfig({})).toThrow(
      SupabaseConfigurationError,
    );
  });

  it("accepts HTTPS hosted configuration", () => {
    expect(
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-test-key",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      anonKey: "public-anon-test-key",
    });
  });

  it("allows the local Supabase HTTP endpoint", () => {
    expect(
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-test-key",
      }).url,
    ).toBe("http://127.0.0.1:54321");
  });
});
