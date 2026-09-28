import { describe, expect, it } from "vitest";

import {
  demoIpDigest, isSameOrigin, parseDemoPersona, trustedDemoIp,
} from "./demo-entry";

describe("Demo entry boundaries", () => {
  it("accepts only the three fixed operational personas", () => {
    expect(parseDemoPersona("ADMIN")).toBe("ADMIN");
    expect(parseDemoPersona("TECHNICIAN")).toBe("TECHNICIAN");
    expect(parseDemoPersona("SUPER_ADMIN")).toBeNull();
    expect(parseDemoPersona("OWNER")).toBeNull();
  });

  it("requires a single proxy-provided IP and hashes it before storage", () => {
    expect(trustedDemoIp(new Headers())).toBeNull();
    expect(trustedDemoIp(new Headers({ "x-vercel-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBeNull();
    expect(trustedDemoIp(new Headers({ "x-vercel-forwarded-for": "arbitrary-key" }))).toBeNull();
    expect(trustedDemoIp(new Headers({ "x-vercel-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(demoIpDigest("1.2.3.4", "secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(demoIpDigest("1.2.3.4", "secret")).not.toContain("1.2.3.4");
  });

  it("rejects cross-origin or malformed form submissions", () => {
    const url = new URL("https://example.com/demo");
    expect(isSameOrigin("https://example.com", url)).toBe(true);
    expect(isSameOrigin("https://evil.example.com", url)).toBe(false);
    expect(isSameOrigin("not a URL", url)).toBe(false);
  });

});
