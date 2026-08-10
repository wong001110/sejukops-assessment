import { describe, expect, it, vi } from "vitest";

import { executeOpenAICompatibleChatCompletion } from "@/lib/ai/providers/openai-compatible";
import type {
  AIProviderConnectionConfig,
  ProviderFetch,
} from "@/lib/ai/providers/types";

const config: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "configured-model",
  apiKey: "test-secret-key",
  capabilities: {
    text: true,
    vision: false,
    toolCalling: true,
    structuredOutput: true,
  },
};

describe("bounded provider runtime completion", () => {
  it("makes one selected-provider attempt and preserves optional real usage/cost", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: '{"ok":true}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 5, cost: 0.00012 },
        }),
        { status: 200 },
      ),
    );
    const result = await executeOpenAICompatibleChatCompletion(
      config,
      {
        messages: [{ role: "user", content: "Return JSON." }],
        maxTokens: 100,
        responseFormat: "JSON_OBJECT",
      },
      {
        fetch: fetchMock,
        resolveHostname: async () => [{ address: "93.184.216.34" }],
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: '{"ok":true}',
      usage: { promptTokens: 20, completionTokens: 5, costUsd: 0.00012 },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "configured-model",
      max_tokens: 100,
      temperature: 0,
      response_format: { type: "json_object" },
    });
  });

  it("never invents missing cost metadata", async () => {
    const result = await executeOpenAICompatibleChatCompletion(
      config,
      { messages: [{ role: "user", content: "Return JSON." }], maxTokens: 10 },
      {
        fetch: vi.fn<ProviderFetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "{}" } }],
            }),
            { status: 200 },
          ),
        ),
        resolveHostname: async () => [{ address: "93.184.216.34" }],
      },
    );
    expect(result.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
    });
  });
});
