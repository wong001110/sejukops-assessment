import { describe, expect, it, vi } from "vitest";

import type { AIProviderConnectionConfig } from "./types";
import type { pinnedHttpsFetch } from "./pinned-https";
import { createPinnedSDKFetch } from "./safe-sdk-provider";

const config: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  model: "test-model",
  apiKey: "test-key",
  capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
};

describe("AI SDK pinned provider transport", () => {
  const resolveHostname = vi.fn(async () => [{ address: "93.184.215.14" }]);

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
});
