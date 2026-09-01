export const AI_ERROR_CODES = [
  "AI_NOT_CONFIGURED",
  "AI_AUTH_FAILED",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_TOOL_FAILED",
  "AI_INVALID_RESPONSE",
  "AI_CAPABILITY_MISMATCH",
  "AI_CONFIG_VALIDATION_FAILED",
  "AI_CONFIG_PERMISSION_DENIED",
  "AI_CONFIG_NOT_FOUND",
  "AI_CONFIG_CONFLICT",
  "AI_CONFIG_ENCRYPTION_UNAVAILABLE",
  "AI_CONFIG_DECRYPTION_FAILED",
  "AI_CONFIG_DATA_ACCESS_FAILED",
  "AI_CONFIG_UNLOCK_REQUIRED",
  "AI_CONFIG_UNLOCK_FAILED",
  "AI_CONFIG_UNLOCK_UNAVAILABLE",
] as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

export class AIConfigError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIConfigError";
  }
}

export const AI_ERROR_MESSAGES: Readonly<Record<AIErrorCode, string>> = {
  AI_NOT_CONFIGURED:
    "AI is not configured for this feature. Ask an Admin to configure a compatible model in AI Settings.",
  AI_AUTH_FAILED:
    "The configured AI provider rejected the credential. An Admin should verify the provider settings and run Test Connection again.",
  AI_RATE_LIMITED:
    "The AI provider is temporarily rate limited. Please try again later. Your operational data has not changed.",
  AI_TIMEOUT:
    "The AI provider did not respond in time. Please retry. The underlying SejukOps data remains available.",
  AI_PROVIDER_UNAVAILABLE:
    "The AI provider is temporarily unavailable. Please retry. The underlying SejukOps data remains available.",
  AI_TOOL_FAILED:
    "SejukOps could not retrieve the operational data needed for this answer. No AI answer was generated.",
  AI_INVALID_RESPONSE:
    "The AI response could not be validated safely. Please retry or choose another compatible model.",
  AI_CAPABILITY_MISMATCH:
    "The selected model does not support this input or task. Choose a compatible model in AI Settings.",
  AI_CONFIG_VALIDATION_FAILED: "Check the AI provider settings and try again.",
  AI_CONFIG_PERMISSION_DENIED: "AI provider settings are available to Admin users only.",
  AI_CONFIG_NOT_FOUND: "The requested AI provider configuration was not found.",
  AI_CONFIG_CONFLICT: "The AI configuration conflicts with its latest saved state.",
  AI_CONFIG_ENCRYPTION_UNAVAILABLE:
    "Encrypted credential storage is not configured on this environment.",
  AI_CONFIG_DECRYPTION_FAILED:
    "The saved provider credential could not be opened safely. Re-enter the credential in AI Settings.",
  AI_CONFIG_DATA_ACCESS_FAILED:
    "AI settings are temporarily unavailable. Please try again.",
  AI_CONFIG_UNLOCK_REQUIRED:
    "Unlock AI configuration editing with the Admin password before making changes.",
  AI_CONFIG_UNLOCK_FAILED: "The Admin password was not accepted.",
  AI_CONFIG_UNLOCK_UNAVAILABLE:
    "AI configuration editing is not available on this environment.",
};
