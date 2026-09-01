import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { cookies } from "next/headers";

import { AIConfigError, AI_ERROR_MESSAGES } from "@/domain/ai-config/errors";
import { getCurrentDemoIdentity } from "@/lib/auth/server";

export const AI_CONFIG_UNLOCK_COOKIE = "sejukops_ai_config_unlock";
const SESSION_DURATION_SECONDS = 15 * 60;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function unavailable(): AIConfigError {
  return new AIConfigError(
    "AI_CONFIG_UNLOCK_UNAVAILABLE",
    AI_ERROR_MESSAGES.AI_CONFIG_UNLOCK_UNAVAILABLE,
    503,
  );
}

function sessionKey(): Buffer {
  const encoded = process.env.AI_CONFIG_SESSION_SECRET?.trim();
  if (!encoded || !SESSION_KEY_PATTERN.test(encoded)) throw unavailable();
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw unavailable();
  }
  return key;
}

function configuredPassword(): string {
  const password = process.env.AI_CONFIG_ADMIN_PASSWORD;
  if (!password || password.length < 24) throw unavailable();
  return password;
}

function passwordDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function hasMatchingPassword(candidate: string, expected: string): boolean {
  const candidateDigest = passwordDigest(candidate);
  const expectedDigest = passwordDigest(expected);
  try {
    return timingSafeEqual(candidateDigest, expectedDigest);
  } finally {
    candidateDigest.fill(0);
    expectedDigest.fill(0);
  }
}

function signature(payload: string, key: Buffer): string {
  try {
    return createHmac("sha256", key)
      .update("sejukops.ai-config.unlock:v1\\0", "utf8")
      .update(payload, "utf8")
      .digest("base64url");
  } finally {
    key.fill(0);
  }
}

function sessionValue(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${issuedAt}.${randomUUID()}`;
  return `${payload}.${signature(payload, sessionKey())}`;
}

async function assertDemoAdmin(): Promise<void> {
  const identity = await getCurrentDemoIdentity();
  if (!identity || identity.role !== "ADMIN") {
    throw new AIConfigError(
      "AI_CONFIG_PERMISSION_DENIED",
      AI_ERROR_MESSAGES.AI_CONFIG_PERMISSION_DENIED,
      403,
    );
  }
}

function validSession(value: string | undefined): boolean {
  if (!value) return false;
  const match = /^(\d{10})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const [, issuedAtText, nonce, suppliedSignature] = match;
  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > SESSION_DURATION_SECONDS) {
    return false;
  }
  let expected: Buffer | undefined;
  let supplied: Buffer | undefined;
  try {
    expected = Buffer.from(signature(`${issuedAtText}.${nonce}`, sessionKey()), "base64url");
    supplied = Buffer.from(suppliedSignature, "base64url");
    return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  } finally {
    expected?.fill(0);
    supplied?.fill(0);
  }
}

export async function isAIConfigUnlocked(): Promise<boolean> {
  const store = await cookies();
  return validSession(store.get(AI_CONFIG_UNLOCK_COOKIE)?.value);
}

export async function assertAIConfigUnlocked(): Promise<void> {
  await assertDemoAdmin();
  if (!(await isAIConfigUnlocked())) {
    throw new AIConfigError(
      "AI_CONFIG_UNLOCK_REQUIRED",
      AI_ERROR_MESSAGES.AI_CONFIG_UNLOCK_REQUIRED,
      403,
    );
  }
}

export async function unlockAIConfig(candidatePassword: string): Promise<void> {
  await assertDemoAdmin();
  if (!hasMatchingPassword(candidatePassword, configuredPassword())) {
    throw new AIConfigError(
      "AI_CONFIG_UNLOCK_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_UNLOCK_FAILED,
      401,
    );
  }
  const store = await cookies();
  store.set(AI_CONFIG_UNLOCK_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_SECONDS,
    path: "/",
  });
}

export async function lockAIConfig(): Promise<void> {
  const store = await cookies();
  store.set(AI_CONFIG_UNLOCK_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}
