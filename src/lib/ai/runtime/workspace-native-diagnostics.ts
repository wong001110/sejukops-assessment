/** Fixed server metadata. Never retain exception text, tool arguments or model payloads. */
export const NATIVE_FAILURE_STAGES = [
  "SCOPE_CHECK", "GENERATION_READ", "PROVIDER_CONFIGURATION", "PROVIDER_REQUEST",
  "PROVIDER_RESPONSE", "TOOL_EXECUTION", "TOOL_INPUT_INVALID", "TOOL_EXECUTION_FAILED",
  "OUTPUT_FORMAT_INVALID", "TOOL_CHOICE_IGNORED", "SOURCE_BINDING", "DISPLAY_VALIDATION", "COMPLETE",
] as const;
export type NativeFailureStage = typeof NATIVE_FAILURE_STAGES[number];

export function nativeFailureMessage(diagnostics: {
  failureStage?: string; providerStatusCode?: number; providerFailureCategory?: string | null;
}) {
  const category = diagnostics.providerFailureCategory;
  const status = diagnostics.providerStatusCode;
  if (category === "CREDENTIAL_REJECTED" || status === 401 || status === 403)
    return "The AI provider rejected its credentials. The Owner can review the AI configuration. Manual actions still work.";
  if (status === 402)
    return "The AI provider account cannot access this request. The Owner can check provider credits and model access. Manual actions still work.";
  if (category === "RATE_LIMIT" || status === 429)
    return "The AI provider is rate limiting requests. Try again later or continue manually.";
  if (category === "REASONING_CONFIGURATION" || category === "TOKEN_LIMIT" || status === 400 || status === 422)
    return "The AI provider rejected the request settings. The Owner can review model compatibility and request limits. Manual actions still work.";
  if (status === 0)
    return "The AI provider connection failed. Try again later or continue manually.";
  if (category === "UPSTREAM_ERROR" || (status !== undefined && status >= 500))
    return "The AI provider returned a service error. Try again later or continue manually.";
  if (diagnostics.failureStage === "PROVIDER_CONFIGURATION")
    return "A compatible AI provider is not available for this task. The Owner can review the AI configuration. Manual actions still work.";
  if (diagnostics.failureStage === "TOOL_CHOICE_IGNORED")
    return "The AI model did not perform the required workspace read. No generated result was accepted. Continue manually or try again later.";
  if (["OUTPUT_FORMAT_INVALID", "SOURCE_BINDING", "DISPLAY_VALIDATION", "TOOL_INPUT_INVALID"].includes(diagnostics.failureStage ?? ""))
    return "The AI response could not be verified against workspace records. No result was accepted. Continue manually or try a smaller request.";
  return "The assistant could not complete this request. Continue from Orders or Knowledge.";
}
