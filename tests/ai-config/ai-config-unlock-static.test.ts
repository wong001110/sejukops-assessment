import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const unlock = readFileSync(resolve("src/lib/auth/ai-config-unlock.ts"), "utf8");
const route = readFileSync(
  resolve("src/app/api/admin/ai-settings/unlock/route.ts"),
  "utf8",
);
const workspace = readFileSync(
  resolve("src/components/admin/ai-settings/ai-settings-workspace.tsx"),
  "utf8",
);

describe("AI configuration unlock boundary", () => {
  it("uses server-only variables with a signed short-lived HttpOnly session", () => {
    expect(unlock).toContain('import "server-only"');
    expect(unlock).toContain("AI_CONFIG_ADMIN_PASSWORD");
    expect(unlock).toContain("AI_CONFIG_SESSION_SECRET");
    expect(unlock).toContain("timingSafeEqual");
    expect(unlock).toContain("SESSION_DURATION_SECONDS = 15 * 60");
    expect(unlock).toContain("httpOnly: true");
    expect(unlock).toContain('sameSite: "strict"');
    expect(unlock).toContain('secure: process.env.NODE_ENV === "production"');
  });

  it("offers an explicit unlock and lock API without accepting a client role", () => {
    expect(route).toContain("unlockAIConfig(password)");
    expect(route).toContain("lockAIConfig()");
    expect(route).toContain('export const runtime = "nodejs"');
    expect(route).not.toContain("identityId");
  });

  it("keeps Demo configuration view-only until the server reports canManage", () => {
    expect(workspace).toContain("snapshot.canManage");
    expect(workspace).toContain("Unlock editing");
    expect(workspace).toContain("Demo view is read-only");
    expect(workspace).toContain("disabled={!snapshot.canManage");
  });
});
