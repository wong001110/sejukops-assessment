import { describe, expect, it } from "vitest";

import { sanitizeAIProviderPayload } from "./ai-provider-observation-server";

describe("AI provider observation payload sanitization", () => {
  it("retains only known numeric usage counters while redacting token credentials", () => {
    const sanitized = sanitizeAIProviderPayload({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
        completion_tokens_details: {
          reasoning_tokens: 12,
          private_vendor_tokens: 99,
          credential: "nested-secret",
        },
        output_tokens_details: { reasoning_tokens: 8 },
        custom_tokens: 22,
        refresh_token: "refresh-secret",
      },
      max_tokens: 900,
      api_key: "provider-secret",
      authorization: "Bearer provider-secret",
    }) as Record<string, unknown>;

    expect(sanitized).toEqual({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
        completion_tokens_details: { reasoning_tokens: 12 },
        output_tokens_details: { reasoning_tokens: 8 },
        custom_tokens: "[REDACTED]",
        refresh_token: "[REDACTED]",
      },
      max_tokens: 900,
      api_key: "[REDACTED]",
      authorization: "[REDACTED]",
    });
  });

  it("redacts string, negative, fractional, and unsafe values under known token-count keys", () => {
    const sanitized = sanitizeAIProviderPayload({
      prompt_tokens: "user-token-secret",
      completion_tokens: -1,
      reasoning_tokens: 1.5,
      input_tokens: Number.MAX_SAFE_INTEGER + 1,
      max_tokens: "credential-string",
      token: 100,
    });

    expect(sanitized).toEqual({
      prompt_tokens: "[REDACTED]",
      completion_tokens: "[REDACTED]",
      reasoning_tokens: "[REDACTED]",
      input_tokens: "[REDACTED]",
      max_tokens: "[REDACTED]",
      token: "[REDACTED]",
    });
  });
});
