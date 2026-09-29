import { describe, expect, it, vi } from "vitest";

import { executeOpenAICompatibleChatCompletion } from "@/lib/ai/providers/openai-compatible";
import type { AIProviderConnectionConfig, ProviderFetch } from "@/lib/ai/providers/types";

const provider: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "configured-vision-model",
  apiKey: "test-only-key",
  capabilities: { text: true, vision: true, toolCalling: false, structuredOutput: true },
};

const response = () => new Response(JSON.stringify({
  choices: [{ message: { role: "assistant", content: '{"ok":true}' } }],
}), { status: 200 });

describe("OpenAI-compatible multimodal boundary", () => {
  it("passes a bounded supported image data URL to the selected provider", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(response());
    await executeOpenAICompatibleChatCompletion(
      provider,
      {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract the source." },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
            },
          ],
        }],
        maxTokens: 50,
        responseFormat: "JSON_OBJECT",
      },
      {
        fetch: fetchMock,
        resolveHostname: async () => [{ address: "93.184.216.34" }],
      },
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects remote/unsupported image URLs before any provider call", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(response());
    await expect(executeOpenAICompatibleChatCompletion(
      provider,
      {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract the source." },
            { type: "image_url", image_url: { url: "https://private.example/source.png" } },
          ],
        }],
        maxTokens: 50,
      },
      { fetch: fetchMock },
    )).rejects.toMatchObject({ code: "AI_CONFIG_VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight provider request when the caller cancels", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<ProviderFetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
    }));
    const completion = executeOpenAICompatibleChatCompletion(provider, {
      messages: [{ role: "user", content: "Extract the source." }], maxTokens: 50,
    }, {
      fetch: fetchMock,
      resolveHostname: async () => [{ address: "93.184.216.34" }],
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();
    await expect(completion).rejects.toBeDefined();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
