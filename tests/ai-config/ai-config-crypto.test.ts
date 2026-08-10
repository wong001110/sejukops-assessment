import { describe, expect, it } from "vitest";

import {
  decryptAIProviderCredential,
  encryptAIProviderCredential,
  parseAIConfigEncryptionKey,
  signAIProviderCreatePayload,
} from "@/lib/services/ai-config/crypto";

const providerId = "00000000-0000-4000-8000-000000000101";
const plaintext = "sk-test-sensitive-credential";
const key = Buffer.alloc(32, 7);

function copyKey(): Buffer {
  return Buffer.from(key);
}

describe("AES-256-GCM provider credential envelope", () => {
  it("round-trips with row/version AAD and exposes only last4 metadata", () => {
    const encrypted = encryptAIProviderCredential(providerId, plaintext, copyKey());
    expect(encrypted.encryptionVersion).toBe(1);
    expect(encrypted.keyLast4).toBe("tial");
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(
      decryptAIProviderCredential(
        { providerConfigId: providerId, ...encrypted },
        copyKey(),
      ),
    ).toBe(plaintext);
  });

  it.each([
    ["provider identity", { providerConfigId: "00000000-0000-4000-8000-000000000102" }],
    ["version", { encryptionVersion: 2 }],
    ["ciphertext", { encryptedApiKey: Buffer.from("tampered").toString("base64") }],
    ["tag", { apiKeyAuthTag: Buffer.alloc(16, 9).toString("base64") }],
  ])("fails safely when %s is changed", (_label, change) => {
    const encrypted = encryptAIProviderCredential(providerId, plaintext, copyKey());
    let caught: unknown;
    try {
      decryptAIProviderCredential(
        { providerConfigId: providerId, ...encrypted, ...change },
        copyKey(),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "AI_CONFIG_DECRYPTION_FAILED" });
    expect(JSON.stringify(caught)).not.toContain(plaintext);
  });

  it("fails safely with a different encryption key", () => {
    const encrypted = encryptAIProviderCredential(providerId, plaintext, copyKey());
    expect(() =>
      decryptAIProviderCredential(
        { providerConfigId: providerId, ...encrypted },
        Buffer.alloc(32, 8),
      ),
    ).toThrowError(expect.objectContaining({ code: "AI_CONFIG_DECRYPTION_FAILED" }));
  });

  it("strictly requires a canonical Base64 encoding of exactly 32 bytes", () => {
    expect(parseAIConfigEncryptionKey(key.toString("base64"))).toEqual(key);
    for (const candidate of [undefined, "", "not-base64", Buffer.alloc(31).toString("base64")]) {
      expect(() => parseAIConfigEncryptionKey(candidate)).toThrowError(
        expect.objectContaining({ code: "AI_CONFIG_ENCRYPTION_UNAVAILABLE" }),
      );
    }
  });

  it("rejects short or whitespace-bearing keys before encryption", () => {
    for (const candidate of ["abc", "ab cd", "ab\ncd"]) {
      expect(() =>
        encryptAIProviderCredential(providerId, candidate, copyKey()),
      ).toThrowError(expect.objectContaining({ code: "AI_CONFIG_VALIDATION_FAILED" }));
    }
  });

  it("creates a deterministic domain-separated HMAC signature without exposing the key", () => {
    const input = {
      name: "Operations",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.example.com/v1",
      model: "ops-model",
      capabilities: {
        text: true,
        vision: false,
        toolCalling: true,
        structuredOutput: true,
      },
      status: "ACTIVE",
      apiKey: plaintext,
      requestKey: "00000000-0000-4000-8000-000000000901",
    } as const;
    const signature = signAIProviderCreatePayload(input, copyKey());
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(signAIProviderCreatePayload(input, copyKey()));
    expect(signature).not.toContain(plaintext);
    expect(
      signAIProviderCreatePayload({ ...input, apiKey: `${plaintext}-changed` }, copyKey()),
    ).not.toBe(signature);
    expect(
      signAIProviderCreatePayload({ ...input, model: "another-model" }, copyKey()),
    ).not.toBe(signature);
  });
});
