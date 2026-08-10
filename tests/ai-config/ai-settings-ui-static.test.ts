import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve("src/components/admin/ai-settings/ai-settings-workspace.tsx"), "utf8");
const api = readFileSync(resolve("src/components/admin/ai-settings/ai-settings-api.ts"), "utf8");
const adminLayout = readFileSync(resolve("src/app/admin/layout.tsx"), "utf8");
const desktopShell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");

describe("Admin AI settings UI security and recovery", () => {
  it("inherits the Admin route guard and is reachable from Admin navigation", () => {
    expect(adminLayout).toContain('requireRole("ADMIN")');
    expect(desktopShell).toContain('key: "/admin/ai-settings"');
  });

  it("renders only safe credential metadata and clears plaintext form state", () => {
    expect(workspace).toContain("profile.credential.last4");
    expect(workspace).not.toContain("profile.apiKey");
    expect(workspace.match(/setFieldValue\("apiKey", ""\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workspace).toContain('autoComplete="new-password"');
  });

  it("provides loading, empty, error retry, connection test and no-silent-fallback states", () => {
    expect(workspace).toContain("<Skeleton active");
    expect(workspace).toContain('description="No saved AI providers"');
    expect(workspace).toContain("AI settings could not be loaded");
    expect(workspace).toContain("Test connection");
    expect(workspace).toContain("no silent runtime failover");
    expect(workspace).toContain("createRequestKey.current ?? crypto.randomUUID()");
    expect(workspace).toContain("createRequestKey.current = undefined");
  });

  it("uses the exact safe nested error envelope", () => {
    expect(api).toContain("error?.fieldErrors");
    expect(api).toContain('error?.message ?? "The AI settings request could not be completed."');
  });
});
