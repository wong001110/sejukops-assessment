import { describe, expect, it } from "vitest";

import {
  demoIpDigest, isSameOrigin, isSameOriginRequest, parseDemoPersona, trustedDemoIp,
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

  it("compares Origin with the inbound Host when Next normalizes its internal URL", () => {
    const request = (origin: string) => new Request("http://localhost:3100/api/demo", {
      headers: { origin, host: "127.0.0.1:3100", "x-forwarded-proto": "http" },
    });
    expect(isSameOriginRequest(request("http://127.0.0.1:3100"))).toBe(true);
    expect(isSameOriginRequest(request("http://evil.example:3100"))).toBe(false);
    expect(isSameOriginRequest(new Request("http://localhost:3100/api/demo"))).toBe(false);
  });

});
