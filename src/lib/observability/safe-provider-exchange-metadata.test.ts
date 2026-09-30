import { describe, expect, it } from "vitest";
import type { AIProviderExchange } from "./ai-provider-observation-server";
import { safeProviderExchangeMetadata } from "./safe-provider-exchange-metadata";

const exchange = (body: unknown, statusCode = 200): AIProviderExchange => ({
  id: "private-id", appTraceId: "private-trace", sequence: 1, task: "WORKSPACE_KNOWLEDGE", createdAt: "private-time",
  providerType: "private-provider", endpoint: "https://private-provider.example", model: "private-model", method: "POST",
  statusCode, statusText: "private-status", durationMs: 25,
  request: { headers: { authorization: "private-key" }, body: { messages: "private-question" } },
  response: { headers: { cookie: "private-cookie" }, body }, error: { name: "private-error", message: "private-message" },
});

describe("safe provider exchange metadata", () => {
  it("keeps bounded usage and fixed diagnostics without retaining payloads or errors", () => {
    const metadata = safeProviderExchangeMetadata([
      exchange({ usage: { prompt_tokens: 11, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 3 } } }),
      exchange({ choices: [{ finish_reason: "error", message: { content: "private-model-response" } }],
        usage: { input_tokens: 4, output_tokens: 2, output_tokens_details: { reasoning_tokens: 1 } },
        error: { code: 1313, message: "private-upstream-error", details: "private-document" } }),
    ]);
    expect(metadata).toEqual({ providerSteps: 2, inputTokens: 15, outputTokens: 9,
      diagnostics: { finalFinishReason: "error", visibleTextLength: 22, reasoningTokens: 4, providerStatusCode: 200, upstreamErrorCode: 1313, providerFailureCategory: "UNKNOWN" } });
    expect(JSON.stringify(metadata)).not.toContain("private-");
  });

  it.each(["1313", "private-error-code", 1.5, Number.NaN, Number.POSITIVE_INFINITY, true])("rejects non-integer upstream code %s", (code) => {
    const metadata = safeProviderExchangeMetadata([exchange({ error: { code } }, 503)]);
    expect(metadata.diagnostics.upstreamErrorCode).toBeUndefined();
    expect(metadata.diagnostics.providerStatusCode).toBe(503);
    expect(metadata.diagnostics.finalFinishReason).toBe("unknown");
  });

  it("bounds provider-supplied counters and normalizes unknown finish strings", () => {
    const metadata = safeProviderExchangeMetadata([exchange({
      usage: { prompt_tokens: 2_000_000, completion_tokens: -1, completion_tokens_details: { reasoning_tokens: "private-reasoning" } },
      choices: [{ finish_reason: "private-finish", message: { content: [{ text: "x".repeat(20_000) }] } }],
    }, 999)]);
    expect(metadata).toMatchObject({ inputTokens: 1_000_000, outputTokens: undefined,
      diagnostics: { finalFinishReason: "unknown", visibleTextLength: 10_000, reasoningTokens: undefined, providerStatusCode: undefined } });
    expect(safeProviderExchangeMetadata([])).toMatchObject({ providerSteps: 0, diagnostics: { finalFinishReason: "unknown", visibleTextLength: 0 } });
  });

  it.each([
    { error: { code: "context_length_exceeded", message: "private-context" }, status: 200, category: "TOKEN_LIMIT" },
    { error: { message: "max_tokens exceeds the token budget; private-details" }, status: 200, category: "TOKEN_LIMIT" },
    { error: { code: "invalid_request_error", param: "reasoning_effort", message: "private-details" }, status: 200, category: "REASONING_CONFIGURATION" },
    { error: { message: "thinking_budget must be smaller; private-details" }, status: 200, category: "REASONING_CONFIGURATION" },
    { error: { code: "rate_limit_exceeded", message: "private-key" }, status: 200, category: "RATE_LIMIT" },
    { error: { message: "private-key" }, status: 401, category: "CREDENTIAL_REJECTED" },
    { error: { code: "invalid_api_key", message: "private-key" }, status: 200, category: "CREDENTIAL_REJECTED" },
    { error: { message: "private-message" }, status: 503, category: "UPSTREAM_ERROR" },
    { error: { code: 1313, message: "private-message" }, status: 200, category: "UNKNOWN" },
  ])("classifies only the explicit error envelope as $category", ({ error, status, category }) => {
    const metadata = safeProviderExchangeMetadata([exchange({ error }, status)]);
    expect(metadata.diagnostics.providerFailureCategory).toBe(category);
    expect(JSON.stringify(metadata)).not.toContain("private-");
  });

  it("accepts a choice error envelope but never classifies model text or absent errors", () => {
    expect(safeProviderExchangeMetadata([exchange({ choices: [{ error: { code: "rate_limit_exceeded" } }] })])
      .diagnostics.providerFailureCategory).toBe("RATE_LIMIT");
    for (const body of [null, { choices: [{ finish_reason: "error", message: { content: "max_tokens exceeds the token budget" } }] },
      { error: "max_tokens exceeds the token budget" }]) {
      expect(safeProviderExchangeMetadata([exchange(body, 503)]).diagnostics.providerFailureCategory).toBeNull();
    }
  });
});
