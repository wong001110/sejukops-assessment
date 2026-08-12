import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const observer = readFileSync(resolve("src/lib/observability/api-observation.ts"), "utf8");
const provider = readFileSync(resolve("src/components/api-observation-provider.tsx"), "utf8");
const appProvider = readFileSync(resolve("src/components/app-query-provider.tsx"), "utf8");
const workspace = readFileSync(resolve("src/components/admin/api-observability/api-observability-workspace.tsx"), "utf8");
const page = readFileSync(resolve("src/app/admin/api-observability/page.tsx"), "utf8");
const shell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");

describe("browser-session API observability", () => {
  it("observes only same-origin API fetches and injects a trace id without touching external requests", () => {
    expect(observer).toContain('url.origin === window.location.origin');
    expect(observer).toContain('url.pathname.startsWith("/api/")');
    expect(observer).toContain('requestHeaders.set("x-sejuk-trace-id", traceId)');
    expect(observer).toContain("return originalFetch(input, init)");
    expect(provider).toContain("useLayoutEffect");
    expect(appProvider).toContain("<ApiObservationProvider>");
  });

  it("keeps observations bounded and session-local instead of creating a new persistence dependency", () => {
    expect(observer).toContain('API_OBSERVATION_STORAGE_KEY = "sejukops:api-observation:v1"');
    expect(observer).toContain("window.sessionStorage");
    expect(observer).toContain("API_OBSERVATION_LIMIT = 150");
    expect(observer).toContain("slice(0, API_OBSERVATION_LIMIT)");
  });

  it("redacts credentials, signed urls and customer contact fields and omits binary request bodies", () => {
    expect(observer).toContain("secretKeyPattern");
    expect(observer).toContain("piiKeyPattern");
    expect(observer).toContain('const REDACTED = "[REDACTED]"');
    expect(observer).toContain('const REDACTED_PII = "[REDACTED_PII]"');
    expect(observer).toContain("[FormData omitted]");
    expect(observer).toContain("[binary body omitted]");
  });

  it("provides an Admin observation workspace with request, response and metadata inspection", () => {
    expect(page).toContain("<ApiObservabilityWorkspace />");
    expect(shell).toContain('key: "/admin/api-observability"');
    expect(shell).toContain('label: "API traces"');
    expect(workspace).toContain('label: "Request"');
    expect(workspace).toContain('label: "Response"');
    expect(workspace).toContain('label: "Metadata"');
    expect(workspace).toContain("Live capture");
    expect(workspace).toContain("Safe observation boundary");
  });
});
