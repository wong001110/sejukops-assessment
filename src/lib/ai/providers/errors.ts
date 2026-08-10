import {
  AIConfigError,
  AI_ERROR_MESSAGES,
  type AIErrorCode,
} from "@/domain/ai-config/errors";

import { UnsafeProviderUrlError } from "./safe-url";

class SanitizedAIProviderError extends AIConfigError {}

export class ProviderTimeoutError extends Error {
  constructor() {
    super("Provider connection test exceeded its deadline.");
    this.name = "ProviderTimeoutError";
  }
}

function providerError(
  code: AIErrorCode,
  status: AIConfigError["status"],
): AIConfigError {
  return new SanitizedAIProviderError(code, AI_ERROR_MESSAGES[code], status);
}

export function normalizeAIProviderError(error: unknown): AIConfigError {
  if (error instanceof SanitizedAIProviderError) return error;
  if (error instanceof AIConfigError) {
    return new AIConfigError(
      error.code,
      AI_ERROR_MESSAGES[error.code],
      error.status,
    );
  }
  if (error instanceof UnsafeProviderUrlError) {
    return providerError("AI_CONFIG_VALIDATION_FAILED", 422);
  }
  if (
    error instanceof ProviderTimeoutError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return providerError("AI_TIMEOUT", 504);
  }
  return providerError("AI_PROVIDER_UNAVAILABLE", 503);
}

export function providerHttpError(status: number): AIConfigError {
  if (status === 401 || status === 403) {
    return providerError("AI_AUTH_FAILED", 401);
  }
  if (status === 402) {
    return new SanitizedAIProviderError(
      "AI_AUTH_FAILED",
      "The provider account or credential cannot access this model. Verify the provider account, key, and available credits, then test again.",
      401,
    );
  }
  if (status === 408 || status === 504) {
    return providerError("AI_TIMEOUT", 504);
  }
  if (status === 429) {
    return providerError("AI_RATE_LIMITED", 429);
  }
  if (status >= 500) {
    return providerError("AI_PROVIDER_UNAVAILABLE", 503);
  }
  return providerError("AI_INVALID_RESPONSE", 502);
}

export function invalidProviderResponse(): AIConfigError {
  return providerError("AI_INVALID_RESPONSE", 502);
}

export function invalidProviderConfiguration(): AIConfigError {
  return providerError("AI_CONFIG_VALIDATION_FAILED", 422);
}

export function isRetryableAIProviderError(error: AIConfigError): boolean {
  return (
    error.code === "AI_RATE_LIMITED" ||
    error.code === "AI_TIMEOUT" ||
    error.code === "AI_PROVIDER_UNAVAILABLE"
  );
}
