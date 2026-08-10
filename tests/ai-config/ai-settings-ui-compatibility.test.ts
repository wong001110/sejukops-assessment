import { describe, expect, it } from "vitest";

import type { AIProviderProfile } from "../../src/domain/ai-config/contracts";
import { missingCapabilities, missingImageDocumentCapabilities, routingProblems } from "../../src/components/admin/ai-settings/compatibility";

const profile = (overrides: Partial<AIProviderProfile> = {}): AIProviderProfile => ({
  id: "6904f50e-2e65-4c5b-b9e0-d4ce49901858",
  name: "Operations model",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "ops-model",
  capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
  status: "ACTIVE",
  credential: { configured: true, last4: "1234" },
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  ...overrides,
});

const emptyRoutes = { OPERATIONS_QUERY: null, WORKFLOW_EXPLANATION: null, OPERATIONAL_INSIGHT: null, DOCUMENT_UNDERSTANDING: null } as const;

describe("Admin AI settings compatibility UI", () => {
  it("allows text-document routing while separately surfacing the image vision mismatch", () => {
    expect(missingCapabilities(profile(), "DOCUMENT_UNDERSTANDING")).not.toContain("vision");
    expect(missingImageDocumentCapabilities(profile())).toContain("vision");
    expect(routingProblems([profile()], "SINGLE_MODEL", profile().id, emptyRoutes)).toEqual([]);
  });

  it("accepts an explicit blank route for environment fallback or Not Configured", () => {
    expect(routingProblems([profile()], "TASK_BASED", null, emptyRoutes)).toEqual([]);
  });

  it("does not treat disabled providers as compatible routing targets", () => {
    const disabled = profile({ status: "DISABLED" });
    expect(routingProblems([disabled], "SINGLE_MODEL", disabled.id, emptyRoutes).length).toBeGreaterThan(0);
  });
});
