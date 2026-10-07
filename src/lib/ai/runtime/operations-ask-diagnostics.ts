export const OPERATIONS_ASK_FAILURE_REASONS = [
  "ACCESS_DENIED", "SCOPE_CHANGED", "INVALID_SCOPE_GENERATION", "PROVIDER_UNAVAILABLE", "PROVIDER_FAILURE",
  "TOOL_INPUT_INVALID", "TOOL_READ_FAILED", "TOOL_INCOMPLETE", "INVALID_JSON", "INVALID_SELECTION",
  "INVALID_EXCERPT", "ORDER_CHANGED", "KNOWLEDGE_CHANGED", "CANCELLED_TIMEOUT", "ALLOWANCE_EXHAUSTED",
  "ALLOWANCE_UNAVAILABLE", "UNEXPECTED_FAILURE",
] as const;
export type OperationsAskFailureReason = typeof OPERATIONS_ASK_FAILURE_REASONS[number];

export const OPERATIONS_SDK_ERROR_KINDS = ["RESPONSE_VALIDATION", "API_CALL", "TOOL_CHOICE", "NO_OUTPUT", "ABORTED", "OTHER"] as const;
export type OperationsSdkErrorKind = typeof OPERATIONS_SDK_ERROR_KINDS[number];

/** Class names are compared, never copied. Payloads/messages and causes are not persisted. */
export function operationsSdkErrorKind(error: unknown): OperationsSdkErrorKind {
  let current = error;
  let apiCall = false;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (["AI_TypeValidationError", "AI_InvalidResponseDataError", "AI_JSONParseError"].includes(current.name)) return "RESPONSE_VALIDATION";
    if (current.name === "AI_NoOutputGeneratedError") return "NO_OUTPUT";
    if (current.name === "AI_ToolChoiceViolationError") return "TOOL_CHOICE";
    if (["AbortError", "TimeoutError"].includes(current.name)) return "ABORTED";
    if (current.name === "AI_APICallError") apiCall = true;
    if (current.cause instanceof Error) { current = current.cause; continue; }
    break;
  }
  return apiCall ? "API_CALL" : "OTHER";
}

/** Fixed messages explain application rejection without echoing model/provider payloads. */
export function operationsAskFailureMessage(reason: OperationsAskFailureReason): string {
  if (["INVALID_EXCERPT", "INVALID_SELECTION", "INVALID_JSON"].includes(reason))
    return "The AI response could not be verified against current sources. No unverified answer was shown. Try again or search manually.";
  if (["TOOL_INPUT_INVALID", "TOOL_INCOMPLETE"].includes(reason))
    return "The AI did not complete a valid evidence lookup. Try a specific order number or search manually.";
  if (reason === "PROVIDER_FAILURE") return "The AI provider request failed. No verified answer is available; try again or search manually.";
  if (reason === "PROVIDER_UNAVAILABLE") return "AI configuration is unavailable for this request. Search manually or ask an administrator to check AI settings.";
  return "Operations AI is unavailable. Search orders or published knowledge manually.";
}
