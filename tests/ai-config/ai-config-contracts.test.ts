import { describe, expect, it } from "vitest";

import {
  createAIProviderSchema,
  missingCapabilitiesForTask,
  normalizeSafeAIBaseUrl,
  testSavedAIProviderSchema,
  updateAIProviderSchema,
  updateAIRoutingSchema,
} from "@/domain/ai-config/contracts";

const capabilities = {
  text: true,
  vision: false,
  toolCalling: true,
  structuredOutput: true,
};

describe("AI configuration browser contracts", () => {
  it("normalizes public HTTPS base URLs and rejects syntactically unsafe targets", () => {
    expect(normalizeSafeAIBaseUrl(" https://api.example.com/v1/ ")).toBe(
      "https://api.example.com/v1",
    );
    for (const url of [
      "http://api.example.com/v1",
      "https://user:pass@api.example.com/v1",
      "https://api.example.com/v1?target=internal",
      "https://api.example.com/v1#fragment",
      "https://localhost/v1",
      "https://provider.local/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.1/v1",
      "https://169.254.169.254/latest",
      "https://172.20.1.2/v1",
      "https://192.168.1.2/v1",
      "https://[::1]/v1",
      "https://192.0.2.8/v1",
    ]) {
      expect(() => normalizeSafeAIBaseUrl(url), url).toThrow();
    }
  });

  it("requires printable four-character-or-longer credentials without echoing them", () => {
    const base = {
      name: "Operations model",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://api.example.com/v1",
      model: "ops-model",
      capabilities,
      status: "ACTIVE",
      requestKey: "00000000-0000-4000-8000-000000000901",
    } as const;
    for (const apiKey of ["a", "abc", "ab cd", "ab\ncd", ""]) {
      const result = createAIProviderSchema.safeParse({ ...base, apiKey });
      expect(result.success, apiKey).toBe(false);
    }
    const uniqueInvalidSecret = "never-echo-this secret";
    const rejected = createAIProviderSchema.safeParse({
      ...base,
      apiKey: uniqueInvalidSecret,
    });
    expect(JSON.stringify(rejected)).not.toContain(uniqueInvalidSecret);
    expect(createAIProviderSchema.safeParse({ ...base, apiKey: "test-key" }).success).toBe(
      true,
    );
    expect(
      createAIProviderSchema.safeParse({
        ...base,
        apiKey: "test-key",
        requestKey: "retry",
      }).success,
    ).toBe(false);
  });

  it("treats blank PATCH/Test credential as preserve/use-saved and validates replacements", () => {
    expect(updateAIProviderSchema.parse({ apiKey: "  " })).toEqual({ apiKey: "" });
    expect(testSavedAIProviderSchema.parse({ apiKey: " " })).toEqual({ apiKey: "" });
    expect(updateAIProviderSchema.safeParse({ apiKey: "abc" }).success).toBe(false);
    expect(testSavedAIProviderSchema.safeParse({ apiKey: "ab cd" }).success).toBe(false);
  });

  it("uses a full clearing-capable discriminated routing replacement", () => {
    expect(
      updateAIRoutingSchema.parse({
        routingMode: "SINGLE_MODEL",
        defaultProviderConfigId: null,
      }),
    ).toEqual({ routingMode: "SINGLE_MODEL", defaultProviderConfigId: null });
    const routes = {
      OPERATIONS_QUERY: null,
      WORKFLOW_EXPLANATION: "00000000-0000-4000-8000-000000000101",
      OPERATIONAL_INSIGHT: null,
      DOCUMENT_UNDERSTANDING: null,
    };
    expect(updateAIRoutingSchema.parse({ routingMode: "TASK_BASED", routes })).toEqual({
      routingMode: "TASK_BASED",
      routes,
    });
    expect(
      updateAIRoutingSchema.safeParse({
        routingMode: "TASK_BASED",
        routes: { OPERATIONS_QUERY: null },
      }).success,
    ).toBe(false);
    expect(
      updateAIRoutingSchema.safeParse({
        routingMode: "SINGLE_MODEL",
        defaultProviderConfigId: null,
        routes,
      }).success,
    ).toBe(false);
  });

  it("validates task capabilities, including vision only for image documents", () => {
    expect(missingCapabilitiesForTask(capabilities, "OPERATIONS_QUERY")).toEqual([]);
    expect(missingCapabilitiesForTask(capabilities, "DOCUMENT_UNDERSTANDING")).toEqual([]);
    expect(
      missingCapabilitiesForTask(capabilities, "DOCUMENT_UNDERSTANDING", "IMAGE"),
    ).toEqual(["vision"]);
    expect(
      missingCapabilitiesForTask(
        { ...capabilities, toolCalling: false },
        "OPERATIONS_QUERY",
      ),
    ).toEqual(["toolCalling"]);
  });
});
