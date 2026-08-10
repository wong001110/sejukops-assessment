import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { safeAIProviderProfile } from "@/domain/ai-config/safe-profile";
import { hasPermission } from "@/lib/auth/permissions";

const service = readFileSync(resolve("src/lib/services/ai-config/service.ts"), "utf8");
const apiRoot = resolve("src/app/api/admin/ai-settings");
const routePaths = [
  "route.ts",
  "providers/route.ts",
  "providers/[id]/route.ts",
  "providers/[id]/test/route.ts",
  "test/route.ts",
  "routing/route.ts",
];

describe("AI configuration service and API security", () => {
  it("grants configuration only to Admin while allowing Manager runtime use", () => {
    expect(hasPermission("ADMIN", "ai_config:view")).toBe(true);
    expect(hasPermission("ADMIN", "ai_config:manage")).toBe(true);
    expect(hasPermission("MANAGER", "ai_config:view")).toBe(false);
    expect(hasPermission("MANAGER", "ai_config:manage")).toBe(false);
    expect(hasPermission("TECHNICIAN", "ai_config:manage")).toBe(false);
    expect(hasPermission("MANAGER", "ai:use")).toBe(true);
    expect(hasPermission("TECHNICIAN", "ai:use")).toBe(false);
  });

  it("returns safe provider metadata without serializing credential envelope fields", () => {
    const plaintext = "never-return-this-key";
    const safe = safeAIProviderProfile({
      id: "00000000-0000-4000-8000-000000000101",
      name: "Test provider",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.example.com/v1",
      model: "test-model",
      capabilities: {
        text: true,
        vision: false,
        toolCalling: true,
        structuredOutput: true,
      },
      credentialConfigured: Boolean(plaintext),
      keyLast4: "-key",
      status: "ACTIVE",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    const serialized = JSON.stringify(safe);
    expect(safe.credential).toEqual({ configured: true, last4: "-key" });
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain("encryptedApiKey");
    expect(serialized).not.toContain("apiKeyIv");
    expect(serialized).not.toContain("apiKeyAuthTag");
  });

  it("checks the active DB actor before privileged configuration reads", () => {
    expect(service).toContain(
      'await assertDatabaseActor(context.supabase, context.identity.profileId, "CONFIG")',
    );
    expect(service.indexOf("await assertDatabaseActor")).toBeLessThan(
      service.indexOf("return buildSnapshot(supabase)"),
    );
  });

  it("preserves blank update credentials and never sends plaintext into an RPC", () => {
    expect(service).toContain("const replacementKey = input.apiKey?.trim()");
    expect(service).toContain("? encryptAIProviderCredential(providerConfigId, replacementKey)");
    expect(service).toContain("encryptedApiKey: existing.encrypted_api_key");
    expect(service).not.toContain("p_api_key: input.apiKey");
  });

  it("uses a HMAC-signed request key and returns the original row on create replay", () => {
    expect(service).toContain("signAIProviderCreatePayload(input)");
    expect(service).toContain("p_create_request_key: createIdentity?.requestKey ?? null");
    expect(service).toContain(
      "p_create_payload_signature: createIdentity?.payloadSignature ?? null",
    );
    expect(service).toContain("const persistedProviderConfigId = text(result.provider_config_id)");
    expect(service).toContain("await getProviderRow(supabase, persistedProviderConfigId)");
    expect(service).not.toContain("p_create_plaintext");
  });

  it("uses saved selection precedence and does not fallback when a saved profile is invalid", () => {
    const resolverStart = service.indexOf("export async function resolveAIProviderForTask");
    const selectedBranch = service.slice(
      service.indexOf("if (selectedId)", resolverStart),
      service.indexOf("const fallback = environmentFallback()", resolverStart),
    );
    expect(selectedBranch).toContain('if (row.status !== "ACTIVE")');
    expect(selectedBranch).toContain("decryptStoredProvider(row)");
    expect(selectedBranch).toContain("assertTaskCompatibility");
    expect(selectedBranch).not.toContain("environmentFallback()");
  });

  it("pins all secret-bearing API routes to the Node runtime", () => {
    for (const relativePath of routePaths) {
      const source = readFileSync(resolve(apiRoot, relativePath), "utf8");
      expect(source, relativePath).toContain('export const runtime = "nodejs"');
    }
  });
});
