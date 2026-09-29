import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve("src/components/admin/ai-settings/ai-settings-workspace.tsx"), "utf8");
const api = readFileSync(resolve("src/components/admin/ai-settings/ai-settings-api.ts"), "utf8");
const platformPage = readFileSync(resolve("src/app/platform/ai-settings/page.tsx"), "utf8");

describe("Platform AI settings UI security and recovery", () => {
  it("uses a verified Super Admin page guard outside Demo navigation", () => {
    expect(platformPage).toContain("getServerActorContext()");
    expect(platformPage).toContain('hasActorPermission(actor, "ai_config:view")');
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
    expect(workspace).toContain("Failures never switch to another provider.");
    expect(workspace).toContain("createRequestKey.current ?? crypto.randomUUID()");
    expect(workspace).toContain("createRequestKey.current = undefined");
  });

  it("uses the exact safe nested error envelope", () => {
    expect(api).toContain("error?.fieldErrors");
    expect(api).toContain('error?.message ?? "The AI settings request could not be completed."');
  });

  it("initializes destroyed modal fields from AntD's post-mount open callback and keeps feedback visible inside", () => {
    const openCreate = workspace.match(/const openCreate = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
    expect(openCreate).not.toContain("form.setFieldsValue");
    expect(workspace).toContain("afterOpenChange={(visible)");
    expect(workspace).toContain("form.setFieldsValue(providerEditorInitialValues(editing))");
    expect(workspace).toContain("feedback={editorFeedback}");
    expect(workspace).toContain('className="ai-editor-feedback"');
  });
});
