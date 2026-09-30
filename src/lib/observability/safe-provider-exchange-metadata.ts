import type { AIProviderExchange } from "./ai-provider-observation-server";

export const PROVIDER_FAILURE_CATEGORIES = ["TOKEN_LIMIT", "REASONING_CONFIGURATION", "RATE_LIMIT", "CREDENTIAL_REJECTED", "UPSTREAM_ERROR", "UNKNOWN"] as const;
type ProviderFailureCategory = typeof PROVIDER_FAILURE_CATEGORIES[number];

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonNegativeInteger(...values: unknown[]): number | undefined {
  return values.find((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) as number | undefined;
}

function safeFinishReason(value: unknown) {
  if (value === "tool_calls") return "tool-calls";
  if (value === "content_filter") return "content-filter";
  if (value === "stop" || value === "length" || value === "error" || value === "other") return value;
  return "unknown";
}

function visibleTextLength(choice: Record<string, unknown> | null): number {
  const content = object(choice?.message)?.content;
  if (typeof content === "string") return Math.min(content.length, 10_000);
  if (!Array.isArray(content)) return 0;
  return content.reduce((length, part) => {
    const text = object(part)?.text;
    return Math.min(length + (typeof text === "string" ? text.length : 0), 10_000);
  }, 0);
}

function providerFailureCategory(error: Record<string, unknown> | null, statusCode: number | undefined): ProviderFailureCategory | null {
  if (!error) return null;
  // Inspect only explicit provider error fields. Never inspect model content or serialize the body.
  const field = (key: string) => typeof error[key] === "string" ? (error[key] as string).slice(0, 2048).toLowerCase() : "";
  const code = field("code"); const type = field("type"); const param = field("param"); const message = field("message");
  if ([code, type].some((value) => ["invalid_api_key", "authentication_error", "unauthorized", "credential_rejected"].includes(value)) || statusCode === 401 || statusCode === 403) return "CREDENTIAL_REJECTED";
  if ([code, type].some((value) => ["rate_limit_exceeded", "rate_limit_error", "too_many_requests"].includes(value)) || statusCode === 429) return "RATE_LIMIT";
  const invalid = /invalid|unsupported|not supported|not allowed|requires?|must|cannot|only/.test(message);
  if ([code, type].some((value) => ["invalid_reasoning_configuration", "unsupported_reasoning", "invalid_thinking_configuration"].includes(value)) ||
      (["reasoning", "reasoning_effort", "thinking", "thinking_budget", "enable_thinking"].includes(param) && [code, type].includes("invalid_request_error")) ||
      (invalid && /reasoning[_ ]effort|thinking[_ ]budget|enable[_ ]thinking|reasoning (?:parameter|configuration)|thinking (?:parameter|configuration)/.test(message))) return "REASONING_CONFIGURATION";
  if ([code, type].some((value) => ["context_length_exceeded", "max_tokens_exceeded", "token_limit_exceeded", "token_budget_exceeded"].includes(value)) ||
      (param === "max_tokens" && (invalid || [code, type].includes("invalid_request_error"))) ||
      (/max[_ ]tokens|token (?:limit|budget)|context[_ ]length/.test(message) && /exceed|too (?:many|large|high)|maximum|must be|less than/.test(message))) return "TOKEN_LIMIT";
  if ([code, type].some((value) => ["server_error", "internal_server_error", "upstream_error", "api_error", "service_unavailable"].includes(value)) ||
      (statusCode !== undefined && statusCode >= 500 && statusCode <= 599)) return "UPSTREAM_ERROR";
  return "UNKNOWN";
}

/** Never return payloads, identifiers, endpoint/model names, credentials, or error strings. */
export function safeProviderExchangeMetadata(exchanges: readonly AIProviderExchange[]) {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let reasoningTokens: number | undefined;
  for (const exchange of exchanges) {
    const usage = object(object(exchange.response.body)?.usage);
    const input = nonNegativeInteger(usage?.prompt_tokens, usage?.input_tokens, usage?.promptTokens);
    const output = nonNegativeInteger(usage?.completion_tokens, usage?.output_tokens, usage?.completionTokens);
    const details = object(usage?.completion_tokens_details) ?? object(usage?.output_tokens_details);
    const reasoning = nonNegativeInteger(details?.reasoning_tokens, usage?.reasoning_tokens, usage?.reasoningTokens);
    if (input !== undefined) inputTokens = Math.min((inputTokens ?? 0) + input, 1_000_000);
    if (output !== undefined) outputTokens = Math.min((outputTokens ?? 0) + output, 1_000_000);
    if (reasoning !== undefined) reasoningTokens = Math.min((reasoningTokens ?? 0) + reasoning, 1_000_000);
  }
  const last = exchanges.at(-1);
  const body = object(last?.response.body);
  const choices = body?.choices;
  const choice = Array.isArray(choices) ? object(choices[0]) : null;
  const error = object(body?.error) ?? object(choice?.error);
  const upstreamErrorCode = error?.code;
  const providerStatusCode = last?.statusCode;
  return {
    providerSteps: Math.min(exchanges.length, 2), inputTokens, outputTokens,
    diagnostics: {
      finalFinishReason: safeFinishReason(choice?.finish_reason ?? choice?.finishReason),
      visibleTextLength: visibleTextLength(choice), reasoningTokens,
      providerStatusCode: typeof providerStatusCode === "number" && Number.isInteger(providerStatusCode) &&
        providerStatusCode >= 0 && providerStatusCode <= 599 ? providerStatusCode : undefined,
      upstreamErrorCode: typeof upstreamErrorCode === "number" && Number.isSafeInteger(upstreamErrorCode) ? upstreamErrorCode : undefined,
      providerFailureCategory: providerFailureCategory(error, providerStatusCode),
    },
  };
}
