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
  it.each([
    { baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3.5-flash-02-23", applied: true },
    { baseUrl: "https://provider.example/v1", model: "qwen/qwen3.5-flash-02-23", applied: false },
    { baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-3.1-pro-preview-customtools", applied: false },
  ])("uses bounded request options only for the exact selected $baseUrl / $model", async ({ baseUrl, model, applied }) => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(response());
    await executeOpenAICompatibleChatCompletion({ ...provider, baseUrl, model }, {
      messages: [{ role: "user", content: "Extract the source." }], maxTokens: 50, responseFormat: "JSON_OBJECT",
    }, { fetch: fetchMock, resolveHostname: async () => [{ address: "93.184.216.34" }] });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ model,
      messages: [{ role: "user", content: "Extract the source." }], max_tokens: 50, temperature: 0,
      response_format: { type: "json_object" }, ...(applied ? { reasoning: { enabled: false } } : {}) });
  });

  it.each([
    { name: "top-level provider error", error: { code: 1313, message: "private-provider-error" }, choice: {} },
    { name: "choice provider error", choice: { error: { message: "private-provider-error" } } },
    ...["length", "content_filter", "error", "tool_calls", "private-provider-reason", null].map((reason) => ({ name: `finish reason ${reason}`, error: undefined, choice: { finish_reason: reason } })),
  ])("rejects valid-looking partial JSON with $name without leaking provider data", async ({ error, choice }) => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(new Response(JSON.stringify({
      ...(error ? { error } : {}),
      choices: [{ message: { role: "assistant", content: '{"ok":true,"customerName":"private-document-value"}' }, ...choice }],
    }), { status: 200 }));
    const completion = executeOpenAICompatibleChatCompletion(provider, {
      messages: [{ role: "user", content: "Extract the source." }], maxTokens: 50, responseFormat: "JSON_OBJECT",
    }, { fetch: fetchMock, resolveHostname: async () => [{ address: "93.184.216.34" }] });
    const failure = await completion.then(() => null, (cause: unknown) => cause);
    expect(failure).toMatchObject({ code: "AI_INVALID_RESPONSE", status: 502 });
    expect(String(failure)).not.toContain("private-");
    expect(JSON.stringify(failure)).not.toContain("private-");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([undefined, "stop"])("accepts compatible successful content with finish reason %s", async (finishReason) => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(new Response(JSON.stringify({ error: null,
      choices: [{ error: null, ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
        message: { role: "assistant", content: '{"ok":true}' } }],
    }), { status: 200 }));
    await expect(executeOpenAICompatibleChatCompletion(provider, {
      messages: [{ role: "user", content: "Extract the source." }], maxTokens: 50, responseFormat: "JSON_OBJECT",
    }, { fetch: fetchMock, resolveHostname: async () => [{ address: "93.184.216.34" }] })).resolves.toMatchObject({ content: '{"ok":true}' });
  });

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
