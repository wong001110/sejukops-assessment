import { describe, expect, it, vi } from "vitest";

import { AIConfigError } from "@/domain/ai-config/errors";
import {
  isRetryableAIProviderError,
  normalizeAIProviderError,
} from "@/lib/ai/providers/errors";
import { openAICompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import type {
  AIProviderConnectionConfig,
  ProviderFetch,
} from "@/lib/ai/providers/types";

const SECRET = "provider-key-must-never-escape";
const config: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "configured-model",
  apiKey: SECRET,
  capabilities: {
    text: true,
    vision: false,
    toolCalling: true,
    structuredOutput: true,
  },
};

const resolvePublic = vi.fn(async () => [{ address: "93.184.216.34" }]);
const assistantResponse = (status = 200) =>
  new Response(
    JSON.stringify({
      model: "provider-reported-model-is-not-trusted",
      choices: [{ message: { role: "assistant", content: "OK" } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  );

describe("OpenAI-compatible Test Connection", () => {
  it("makes one bounded minimal server request and returns only the safe result", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(assistantResponse());

    const result = await openAICompatibleAdapter.testConnection(config, {
      fetch: fetchMock,
      resolveHostname: resolvePublic,
      timeoutMs: 250,
      now: () => new Date("2026-08-10T01:02:03.000Z"),
    });

    expect(result).toEqual({ ok: true, checkedAt: "2026-08-10T01:02:03.000Z" });
    expect(result).not.toHaveProperty("model");
    expect(result).not.toHaveProperty("capabilities");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe("https://api.example.com/v1/chat/completions");
    expect(request).toMatchObject({ method: "POST", redirect: "manual" });
    expect((request?.headers as Record<string, string>).authorization).toBe(
      `Bearer ${SECRET}`,
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "configured-model",
      messages: [
        {
          role: "user",
          content: "Reply with OK to confirm this model is available.",
        },
      ],
      max_tokens: 8,
      temperature: 0,
    });
  });

  it.each([
    [401, "AI_AUTH_FAILED", false],
    [403, "AI_AUTH_FAILED", false],
    [402, "AI_AUTH_FAILED", false],
    [429, "AI_RATE_LIMITED", true],
    [500, "AI_PROVIDER_UNAVAILABLE", true],
    [503, "AI_PROVIDER_UNAVAILABLE", true],
    [408, "AI_TIMEOUT", true],
    [504, "AI_TIMEOUT", true],
    [400, "AI_INVALID_RESPONSE", false],
  ] as const)(
    "normalizes HTTP %i without exposing the provider body",
    async (status, code, retryable) => {
      const providerBody = `raw-provider-body-${SECRET}`;
      const fetchMock = vi
        .fn<ProviderFetch>()
        .mockResolvedValue(new Response(providerBody, { status }));

      const failure = await openAICompatibleAdapter
        .testConnection(config, {
          fetch: fetchMock,
          resolveHostname: resolvePublic,
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AIConfigError);
      expect(failure).toMatchObject({ code });
      expect(isRetryableAIProviderError(failure as AIConfigError)).toBe(retryable);
      expect(String((failure as Error).message)).not.toContain(SECRET);
      expect(String((failure as Error).message)).not.toContain(providerBody);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("times out the entire resolution/request boundary and does not retry", async () => {
    const fetchMock = vi.fn<ProviderFetch>(() => new Promise(() => undefined));

    await expect(
      openAICompatibleAdapter.testConnection(config, {
        fetch: fetchMock,
        resolveHostname: resolvePublic,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT", status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("normalizes network errors without copying an unsafe exception message", async () => {
    const fetchMock = vi
      .fn<ProviderFetch>()
      .mockRejectedValue(new TypeError(`network rejected ${SECRET}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const failure = await openAICompatibleAdapter
      .testConnection(config, { fetch: fetchMock, resolveHostname: resolvePublic })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", status: 503 });
    expect(String((failure as Error).message)).not.toContain(SECRET);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  it.each([
    new Response("not-json", { status: 200 }),
    new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant" } }] }),
      { status: 200 },
    ),
  ])("rejects malformed successful responses", async (response) => {
    await expect(
      openAICompatibleAdapter.testConnection(config, {
        fetch: vi.fn<ProviderFetch>().mockResolvedValue(response),
        resolveHostname: resolvePublic,
      }),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
  });

  it("normalizes unknown errors into one stable provider category", () => {
    const failure = normalizeAIProviderError(new Error(`unsafe ${SECRET}`));
    expect(failure).toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", status: 503 });
    expect(failure.message).not.toContain(SECRET);
  });

  it("re-sanitizes canonical errors supplied by an untrusted dependency", () => {
    const failure = normalizeAIProviderError(
      new AIConfigError("AI_AUTH_FAILED", `unsafe ${SECRET}`, 401),
    );
    expect(failure).toMatchObject({ code: "AI_AUTH_FAILED", status: 401 });
    expect(failure.message).not.toContain(SECRET);
  });

  it.each(["", "abc", "has space", "line\nbreak", "non-ascii-密钥"])(
    "rejects malformed direct API key input before issuing a request",
    async (apiKey) => {
      const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(assistantResponse());
      await expect(
        openAICompatibleAdapter.testConnection(
          { ...config, apiKey },
          { fetch: fetchMock, resolveHostname: resolvePublic },
        ),
      ).rejects.toMatchObject({ code: "AI_CONFIG_VALIDATION_FAILED" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
