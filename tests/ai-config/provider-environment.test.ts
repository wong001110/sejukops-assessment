import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("OpenRouter deployment fallback", () => {
  it("is available only when key, base URL, and model are all configured", async () => {
    const { getOpenRouterEnvironmentFallback } = await import(
      "@/lib/ai/providers/environment"
    );
    const fallback = getOpenRouterEnvironmentFallback({
      OPENROUTER_API_KEY: " secret ",
      OPENROUTER_BASE_URL: " https://openrouter.ai/api/v1 ",
      OPENROUTER_MODEL: " qwen/model ",
    });

    expect(fallback).toEqual({
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "qwen/model",
      apiKey: "secret",
      capabilities: {
        text: true,
        vision: false,
        toolCalling: false,
        structuredOutput: false,
      },
      source: "ENVIRONMENT",
    });
  });

  it.each(["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_MODEL"])(
    "does not synthesize a fallback when %s is missing",
    async (missing) => {
      const { getOpenRouterEnvironmentFallback } = await import(
        "@/lib/ai/providers/environment"
      );
      const environment: Record<string, string | undefined> = {
        OPENROUTER_API_KEY: "secret",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        OPENROUTER_MODEL: "qwen/model",
      };
      delete environment[missing];
      expect(getOpenRouterEnvironmentFallback(environment)).toBeNull();
    },
  );

  it("never infers vision, tools, or structured output from an arbitrary model name", async () => {
    const { getOpenRouterEnvironmentFallback } = await import(
      "@/lib/ai/providers/environment"
    );
    const fallback = getOpenRouterEnvironmentFallback({
      OPENROUTER_API_KEY: "secret",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENROUTER_MODEL: "vendor/model-name-containing-vision-tools-json",
    });

    expect(fallback?.capabilities).toEqual({
      text: true,
      vision: false,
      toolCalling: false,
      structuredOutput: false,
    });
  });

  it("does not infer incomplete DeepSeek or MiMo configurations from key-only values", async () => {
    const { getOpenRouterEnvironmentFallback } = await import(
      "@/lib/ai/providers/environment"
    );
    expect(
      getOpenRouterEnvironmentFallback({
        DEEPSEEK_API_KEY: "deepseek-secret",
        MIMO_API_KEY: "mimo-secret",
      }),
    ).toBeNull();
  });

  it.each(["abc", "has space", "line\nbreak", "密钥-value"])(
    "rejects malformed environment credentials without constructing a fallback",
    async (apiKey) => {
      const { getOpenRouterEnvironmentFallback } = await import(
        "@/lib/ai/providers/environment"
      );
      expect(
        getOpenRouterEnvironmentFallback({
          OPENROUTER_API_KEY: apiKey,
          OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
          OPENROUTER_MODEL: "qwen/model",
        }),
      ).toBeNull();
    },
  );
});
