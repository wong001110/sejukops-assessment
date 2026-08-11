import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AIChatCompletionRequest, AIProviderConnectionConfig } from "@/lib/ai/providers";
import { runDocumentExtraction } from "@/lib/services/document-understanding/runtime";

const provider: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "configured-document-model",
  apiKey: "test-only-key",
  capabilities: { text: true, vision: true, toolCalling: false, structuredOutput: true },
};

const content = JSON.stringify({
  customerName: { value: "Nur Aina", confidence: "high" },
  serviceType: { value: "Aircond Repair", confidence: "high" },
  serviceDetails: { value: "Replace fictional capacitor", confidence: "medium" },
  amount: { value: 320, confidence: "high" },
  date: { value: "2026-08-14", confidence: "high" },
});

describe("document provider input routing", () => {
  it("uses extracted source text for PDF/text without sending raw bytes", async () => {
    let captured: AIChatCompletionRequest | undefined;
    const draft = await runDocumentExtraction(
      provider,
      "application/pdf",
      new Uint8Array([1, 2, 3]),
      {
        extractText: vi.fn().mockResolvedValue("Customer: Nur Aina"),
        requestCompletion: async (_provider, request) => {
          captured = request;
          return { content, usage: { promptTokens: 10, completionTokens: 10, costUsd: null } };
        },
      },
    );
    expect(draft.customerName.value).toBe("Nur Aina");
    expect(captured?.messages[1].content).toContain("Customer: Nur Aina");
    expect(JSON.stringify(captured)).not.toContain("AQID");
  });

  it("uses one bounded data URL image part for the vision path", async () => {
    let captured: AIChatCompletionRequest | undefined;
    const scannedFixture = Buffer.from(
      readFileSync(
        resolve("tests/fixtures/documents/scanned-service-note.png.base64"),
        "utf8",
      ).trim(),
      "base64",
    );
    await runDocumentExtraction(
      provider,
      "image/png",
      new Uint8Array(scannedFixture),
      {
        requestCompletion: async (_provider, request) => {
          captured = request;
          return { content, usage: { promptTokens: null, completionTokens: null, costUsd: null } };
        },
      },
    );
    const userContent = captured?.messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(JSON.stringify(userContent)).toContain("data:image/png;base64,");
    expect(captured?.responseFormat).toBe("JSON_OBJECT");
  });
});
