import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import type { CreateAIProviderInput } from "@/domain/ai-config/contracts";
import { AIConfigError, AI_ERROR_MESSAGES } from "@/domain/ai-config/errors";

export const AI_CREDENTIAL_ENCRYPTION_VERSION = 1 as const;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const STRICT_32_BYTE_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

export type EncryptedAIProviderCredential = Readonly<{
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
  encryptionVersion: typeof AI_CREDENTIAL_ENCRYPTION_VERSION;
  keyLast4: string;
}>;

export type StoredAIProviderCredential = Readonly<{
  providerConfigId: string;
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
  encryptionVersion: number;
}>;

function encryptionUnavailable(): AIConfigError {
  return new AIConfigError(
    "AI_CONFIG_ENCRYPTION_UNAVAILABLE",
    AI_ERROR_MESSAGES.AI_CONFIG_ENCRYPTION_UNAVAILABLE,
    503,
  );
}

export function parseAIConfigEncryptionKey(value = process.env.AI_CONFIG_ENCRYPTION_KEY): Buffer {
  const encoded = value?.trim();
  if (!encoded || !STRICT_32_BYTE_BASE64.test(encoded)) {
    throw encryptionUnavailable();
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw encryptionUnavailable();
  }
  return key;
}

export function signAIProviderCreatePayload(
  input: CreateAIProviderInput,
  encryptionKey = parseAIConfigEncryptionKey(),
): string {
  if (encryptionKey.byteLength !== 32) throw encryptionUnavailable();
  const canonicalPayload = JSON.stringify({
    version: 1,
    name: input.name,
    providerType: input.providerType,
    baseUrl: input.baseUrl,
    model: input.model,
    capabilities: {
      text: input.capabilities.text,
      vision: input.capabilities.vision,
      toolCalling: input.capabilities.toolCalling,
      structuredOutput: input.capabilities.structuredOutput,
    },
    status: input.status,
    apiKey: input.apiKey,
  });
  return createHmac("sha256", encryptionKey)
    .update("sejukops.ai-provider.create-payload:v1\0", "utf8")
    .update(canonicalPayload, "utf8")
    .digest("hex");
}

function credentialAad(providerConfigId: string, version: number): Buffer {
  return Buffer.from(
    `sejukops.ai-provider:${providerConfigId}:v${version}`,
    "utf8",
  );
}

function decodeStoredPart(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Invalid credential encoding");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new Error("Invalid credential encoding");
  }
  return decoded;
}

export function encryptAIProviderCredential(
  providerConfigId: string,
  plaintextApiKey: string,
  encryptionKey = parseAIConfigEncryptionKey(),
): EncryptedAIProviderCredential {
  const apiKey = plaintextApiKey.trim();
  if (apiKey.length < 4 || !/^[!-~]+$/.test(apiKey)) {
    throw new AIConfigError(
      "AI_CONFIG_VALIDATION_FAILED",
      "Enter a valid provider API key.",
      400,
    );
  }
  if (encryptionKey.byteLength !== 32) throw encryptionUnavailable();

  const iv = randomBytes(AES_GCM_IV_BYTES);
  try {
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    cipher.setAAD(
      credentialAad(providerConfigId, AI_CREDENTIAL_ENCRYPTION_VERSION),
    );
    const encrypted = Buffer.concat([
      cipher.update(apiKey, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    try {
      return {
        encryptedApiKey: encrypted.toString("base64"),
        apiKeyIv: iv.toString("base64"),
        apiKeyAuthTag: authTag.toString("base64"),
        encryptionVersion: AI_CREDENTIAL_ENCRYPTION_VERSION,
        keyLast4: apiKey.slice(-4),
      };
    } finally {
      encrypted.fill(0);
      authTag.fill(0);
    }
  } finally {
    iv.fill(0);
  }
}

export function decryptAIProviderCredential(
  stored: StoredAIProviderCredential,
  encryptionKey = parseAIConfigEncryptionKey(),
): string {
  if (
    stored.encryptionVersion !== AI_CREDENTIAL_ENCRYPTION_VERSION ||
    encryptionKey.byteLength !== 32
  ) {
    if (encryptionKey.byteLength !== 32) encryptionKey.fill(0);
    throw new AIConfigError(
      "AI_CONFIG_DECRYPTION_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_DECRYPTION_FAILED,
      503,
    );
  }

  let iv: Buffer | undefined;
  let authTag: Buffer | undefined;
  let encrypted: Buffer | undefined;
  try {
    iv = decodeStoredPart(stored.apiKeyIv);
    authTag = decodeStoredPart(stored.apiKeyAuthTag);
    encrypted = decodeStoredPart(stored.encryptedApiKey);
    if (iv.byteLength !== AES_GCM_IV_BYTES || authTag.byteLength !== AES_GCM_TAG_BYTES) {
      throw new Error("Invalid credential envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    decipher.setAAD(
      credentialAad(stored.providerConfigId, stored.encryptionVersion),
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new AIConfigError(
      "AI_CONFIG_DECRYPTION_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_DECRYPTION_FAILED,
      503,
    );
  } finally {
    iv?.fill(0);
    authTag?.fill(0);
    encrypted?.fill(0);
  }
}
