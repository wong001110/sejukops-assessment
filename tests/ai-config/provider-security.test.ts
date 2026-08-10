import { describe, expect, it, vi } from "vitest";

import { openAICompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import type {
  AIProviderConnectionConfig,
  ProviderFetch,
} from "@/lib/ai/providers/types";

const baseConfig: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "model",
  apiKey: "secret",
  capabilities: {
    text: true,
    vision: false,
    toolCalling: false,
    structuredOutput: false,
  },
};

const success = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "OK" } }],
    }),
    { status: 200 },
  );

describe("provider endpoint SSRF boundary", () => {
  it.each([
    "http://api.example.com/v1",
    "https://user:password@api.example.com/v1",
    "https://api.example.com/v1?redirect=https://internal.local",
    "https://api.example.com/v1#fragment",
    "https://localhost/v1",
    "https://provider.local/v1",
    "https://provider.internal/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.1/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.4/v1",
    "https://[::1]/v1",
    "https://[fe80::1]/v1",
  ])("rejects unsafe base URL %s before fetch", async (baseUrl) => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(success());
    await expect(
      openAICompatibleAdapter.testConnection(
        { ...baseConfig, baseUrl },
        {
          fetch: fetchMock,
          resolveHostname: vi.fn(async () => [{ address: "93.184.216.34" }]),
        },
      ),
    ).rejects.toMatchObject({ code: "AI_CONFIG_VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [[{ address: "10.1.2.3" }]],
    [[{ address: "93.184.216.34" }, { address: "127.0.0.1" }]],
    [[{ address: "2001:db8::1" }]],
    [[]],
  ])("rejects DNS answers containing a non-public destination", async (addresses) => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(success());
    await expect(
      openAICompatibleAdapter.testConnection(baseConfig, {
        fetch: fetchMock,
        resolveHostname: vi.fn(async () => addresses),
      }),
    ).rejects.toMatchObject({ code: "AI_CONFIG_VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects without following their Location", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );

    await expect(
      openAICompatibleAdapter.testConnection(baseConfig, {
        fetch: fetchMock,
        resolveHostname: vi.fn(async () => [{ address: "93.184.216.34" }]),
      }),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("includes DNS resolution in the timeout and never fetches after that deadline", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(success());
    await expect(
      openAICompatibleAdapter.testConnection(baseConfig, {
        fetch: fetchMock,
        resolveHostname: vi.fn(
          () => new Promise<readonly { address: string }[]>(() => undefined),
        ),
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sanitizes DNS resolver failures as provider unavailability", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(success());
    await expect(
      openAICompatibleAdapter.testConnection(baseConfig, {
        fetch: fetchMock,
        resolveHostname: vi.fn(async () => {
          throw new Error("resolver details must stay server-private");
        }),
      }),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      message:
        "The AI provider is temporarily unavailable. Please retry. The underlying SejukOps data remains available.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only all-public DNS answers", async () => {
    const fetchMock = vi.fn<ProviderFetch>().mockResolvedValue(success());
    await expect(
      openAICompatibleAdapter.testConnection(baseConfig, {
        fetch: fetchMock,
        resolveHostname: vi.fn(async () => [
          { address: "93.184.216.34" },
          { address: "2606:2800:220:1:248:1893:25c8:1946" },
        ]),
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
