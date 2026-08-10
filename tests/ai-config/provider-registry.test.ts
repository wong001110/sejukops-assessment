import { describe, expect, it, vi } from "vitest";

import type { ProviderFetch } from "@/lib/ai/providers/types";

vi.mock("server-only", () => ({}));

describe("provider registry selection", () => {
  it("tests only the selected provider once and never falls through on failure", async () => {
    const { testAIProviderConnection } = await import(
      "@/lib/ai/providers/registry"
    );
    const fetchMock = vi
      .fn<ProviderFetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      testAIProviderConnection(
        {
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: "https://selected.example.com/v1",
          model: "selected-model",
          apiKey: "selected-key",
          capabilities: {
            text: true,
            vision: false,
            toolCalling: false,
            structuredOutput: false,
          },
          source: "SAVED",
        },
        {
          fetch: fetchMock,
          resolveHostname: vi.fn(async () => [{ address: "93.184.216.34" }]),
        },
      ),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://selected.example.com/v1/chat/completions",
    );
  });
});
