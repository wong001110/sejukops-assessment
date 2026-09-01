import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appProvider = readFileSync(
  resolve("src/components/app-query-provider.tsx"),
  "utf8",
);
const store = readFileSync(
  resolve("src/lib/observability/ai-observation-store.ts"),
  "utf8",
);
const diagnosticsPage = readFileSync(
  resolve("src/app/diagnostics/ai-observability/page.tsx"),
  "utf8",
);
const diagnosticsApi = readFileSync(
  resolve("src/app/api/diagnostics/ai-observability/route.ts"),
  "utf8",
);
const legacyPage = readFileSync(
  resolve("src/app/admin/api-observability/page.tsx"),
  "utf8",
);
const shell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");
const permissions = readFileSync(resolve("src/lib/auth/permissions.ts"), "utf8");
const roles = readFileSync(resolve("src/lib/auth/types.ts"), "utf8");

describe("centralized assessment diagnostics", () => {
  it("removes browser-local observation from the runtime path", () => {
    expect(appProvider).not.toContain("ApiObservationProvider");
    expect(appProvider).not.toContain("sessionStorage");
    expect(store).toContain('AI_OBSERVATION_EVENT_TYPE = "AI_OBSERVATION"');
    expect(store).toContain('.from("audit_logs")');
    expect(store).toContain("AI_OBSERVATION_RETENTION_DAYS = 7");
  });

  it("keeps diagnostics outside the business navigation and does not add a fourth role", () => {
    expect(roles).toContain('"ADMIN" | "TECHNICIAN" | "MANAGER"');
    expect(roles).not.toContain("SYSTEM_ADMIN");
    expect(permissions).toContain('"diagnostics:view"');
    expect(shell).not.toContain('key: "/admin/api-observability"');
    expect(shell).toContain('label: "AI configuration"');
    expect(shell).toContain("Technical review · AI observability");
    expect(diagnosticsPage).toContain("Assessment diagnostics · not a business role");
    expect(legacyPage).toContain('redirect("/diagnostics/ai-observability")');
  });

  it("protects the central trace feed while keeping reviewer access available to Admin and Manager", () => {
    expect(permissions).toMatch(/ADMIN:[\s\S]*"diagnostics:view"/);
    expect(permissions).toMatch(/MANAGER:[\s\S]*"diagnostics:view"/);
    expect(diagnosticsApi).toContain("listAIObservations");
    expect(diagnosticsApi).toContain("DIAGNOSTICS_PERMISSION_DENIED");
  });

  it("persists only sanitized provider debugging evidence", () => {
    expect(store).toContain("rawPromptPersisted: false");
    expect(store).toContain("rawProviderResponsePersisted: false");
    expect(store).toContain("sanitizedDebugPayloadPersisted: true");
    expect(store).toContain("credentialsPersisted: false");
    expect(store).toContain("documentFieldValuesPersisted: false");
    expect(store).toContain("function requestMetadata");
    expect(store).toContain("function responseMetadata");
    expect(store).not.toContain("systemPromptFromBody");
    expect(store).not.toContain("metadata_json: input.exchanges");
  });
});
