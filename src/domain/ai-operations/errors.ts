import type {
  AIOperationsErrorCode,
  AIOperationsErrorEnvelope,
} from "./contracts";

type AIOperationsErrorStatus =
  | 400
  | 401
  | 403
  | 409
  | 422
  | 429
  | 500
  | 502
  | 503
  | 504;

export class AIOperationsError extends Error {
  constructor(
    readonly code: AIOperationsErrorCode,
    message: string,
    readonly status: AIOperationsErrorStatus,
    readonly retryable: boolean,
    readonly action: AIOperationsErrorEnvelope["error"]["action"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIOperationsError";
  }

  toEnvelope(): AIOperationsErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        action: this.action,
      },
    };
  }
}

export const AI_OPERATIONS_MESSAGES: Readonly<
  Record<AIOperationsErrorCode, string>
> = {
  AI_OPERATIONS_VALIDATION_FAILED:
    "Check the operations question or submitted values and try again.",
  AI_OPERATIONS_PERMISSION_DENIED:
    "The AI Operations Assistant is available to active Manager users only.",
  AI_OPERATIONS_CONTEXT_REQUIRED:
    "This follow-up needs more context. Start with a supported operations question.",
  AI_OPERATIONS_STALE_METRICS:
    "Dashboard metrics changed before the insight was generated. Refresh the dashboard and try again.",
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
    "SejukOps could not retrieve the operational data needed for this answer. No AI answer was generated. Please retry or use the normal operations screens.",
  AI_INVALID_RESPONSE:
    "The AI response could not be validated safely. Please retry or choose another compatible model.",
  AI_CAPABILITY_MISMATCH:
    "The selected model does not support this task. Choose a compatible model in AI Settings.",
};
