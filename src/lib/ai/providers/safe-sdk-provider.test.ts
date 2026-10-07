import { describe, expect, it, vi } from "vitest";

import type { AIProviderConnectionConfig } from "./types";
import type { pinnedHttpsFetch } from "./pinned-https";
import { createPinnedSDKFetch, createSafeSDKChatModel } from "./safe-sdk-provider";

const config: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  model: "test-model",
  apiKey: "test-key",
  capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
};

describe("AI SDK pinned provider transport", () => {
  const resolveHostname = vi.fn(async () => [{ address: "93.184.215.14" }]);

  it.each([true, false])("honors the configured structured-output capability on the actual SDK wire (%s)", async (supported) => {
    const send = vi.fn<typeof pinnedHttpsFetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: '{"result":"fictional"}' }, finish_reason: "stop" }],
    }), { headers: { "Content-Type": "application/json" } }));
    const model = createSafeSDKChatModel({ ...config, capabilities: { ...config.capabilities, structuredOutput: supported } }, { resolveHostname, send });
    const schema = { type: "object" as const, properties: { result: { type: "string" as const } }, required: ["result"], additionalProperties: false };
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Fictional source only" }] }],
      responseFormat: { type: "json", schema, name: "fictional_result" } });
    const request = JSON.parse(String(send.mock.calls[0][1].body));
    expect(request.response_format).toEqual(supported ? { type: "json_schema", json_schema: { schema, strict: true, name: "fictional_result" } } : { type: "json_object" });
    expect(send.mock.calls[0][0].connectAddress).toBe("93.184.215.14");
    expect(new Headers(send.mock.calls[0][1].headers).get("authorization")).toBe("Bearer test-key");
  });

  it("only forwards the expected chat-completions POST to the pinned transport", async () => {
    const send = vi.fn<typeof pinnedHttpsFetch>().mockResolvedValue(new Response("{}"));
    const fetch = createPinnedSDKFetch(config, { resolveHostname, send });
    await fetch("https://provider.example/v1/chat/completions", {
      method: "POST",
      body: "{}",
      headers: { authorization: "Bearer test-key" },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      connectAddress: "93.184.215.14",
      hostname: "provider.example",
    });
  });

  it.each([
    "https://provider.example/v1/embeddings",
    "https://evil.example/v1/chat/completions",
    "https://provider.example/v1/chat/completions?redirect=1",
  ])("rejects an unexpected SDK target: %s", async (url) => {
    const send = vi.fn(async () => new Response("{}"));
    await expect(createPinnedSDKFetch(config, { resolveHostname, send })(url, {
      method: "POST", body: "{}",
    })).rejects.toThrow("not allowed");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a private DNS answer before sending", async () => {
    const send = vi.fn(async () => new Response("{}"));
    await expect(createPinnedSDKFetch(config, {
      resolveHostname: async () => [{ address: "127.0.0.1" }], send,
    })("https://provider.example/v1/chat/completions", {
      method: "POST", body: "{}",
    })).rejects.toThrow("not allowed");
    expect(send).not.toHaveBeenCalled();
  });

  it("applies the exact OpenRouter model policy without changing SDK tools or transport metadata", async () => {
    const selected = { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3.5-flash-02-23" };
    const send = vi.fn<typeof pinnedHttpsFetch>().mockResolvedValue(new Response("{}"));
    const controller = new AbortController();
    const body = { model: selected.model, max_tokens: 400, messages: [{ role: "user", content: "Fictional question" }],
      tools: [{ type: "function", function: { name: "searchKnowledge" } }], tool_choice: "required" };
    await createPinnedSDKFetch(selected, { resolveHostname, send })("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", body: JSON.stringify(body), headers: { authorization: "Bearer test-key" }, signal: controller.signal,
    });
    expect(JSON.parse(String(send.mock.calls[0][1].body))).toEqual({ ...body, reasoning: { enabled: false } });
    expect(send.mock.calls[0][0]).toMatchObject({ hostname: "openrouter.ai", connectAddress: "93.184.215.14" });
    expect(send.mock.calls[0][1].signal).toBe(controller.signal);
    expect(new Headers(send.mock.calls[0][1].headers).get("authorization")).toBe("Bearer test-key");
  });

  it.each([
    { baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-3.1-pro-preview-customtools" },
    { baseUrl: "https://provider.example/v1", model: "qwen/qwen3.5-flash-02-23" },
  ])("preserves the original request byte-for-byte for $baseUrl / $model", async (selected) => {
    const send = vi.fn<typeof pinnedHttpsFetch>().mockResolvedValue(new Response("{}"));
    const init = { method: "POST", body: '{ "model": "configured", "reasoning": { "enabled": true }, "max_tokens": 400 }' };
    await createPinnedSDKFetch({ ...config, ...selected }, { resolveHostname, send })(`${selected.baseUrl}/chat/completions`, init);
    expect(send.mock.calls[0][1]).toBe(init);
  });

  it("retains target, DNS, model and final-body bounds for the rewritten request", async () => {
    const selected = { ...config, baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3.5-flash-02-23" };
    const send = vi.fn<typeof pinnedHttpsFetch>().mockResolvedValue(new Response("{}"));
    const fetch = createPinnedSDKFetch(selected, { resolveHostname, send });
    const normal = JSON.stringify({ model: selected.model });
    await expect(fetch("https://evil.example/api/v1/chat/completions", { method: "POST", body: normal })).rejects.toThrow("not allowed");
    await expect(createPinnedSDKFetch(selected, { resolveHostname: async () => [{ address: "127.0.0.1" }], send })(
      "https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: normal })).rejects.toThrow("not allowed");
    for (const body of ["not-json", "[]", '{"model":"other-model"}']) {
      await expect(fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body })).rejects.toThrow("not allowed");
    }
    const seed = { model: selected.model, padding: "" };
    const body = JSON.stringify({ ...seed, padding: "x".repeat(131_072 - Buffer.byteLength(JSON.stringify(seed), "utf8")) });
    expect(Buffer.byteLength(body, "utf8")).toBe(131_072);
    await expect(fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body })).rejects.toThrow("not allowed");
    expect(send).not.toHaveBeenCalled();
  });
});
