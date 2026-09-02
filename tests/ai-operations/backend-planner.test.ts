import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseOperationsPlanContent,
  planOperationsRequest,
} from "@/lib/ai/runtime/operations-planner";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers";

const provider: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://api.example.com/v1",
  model: "configured-model",
  apiKey: "test-key",
  capabilities: {
    text: true,
    vision: false,
    toolCalling: true,
    structuredOutput: true,
  },
};

describe("Operations planner provider-output boundary", () => {
  it("accepts one strict plan wrapped by a provider fence or preamble", () => {
    expect(
      parseOperationsPlanContent(
        '```json\n{"outcome":"TOOL","intent":"JOBS_LOOKUP","toolName":"getJobs","arguments":{"period":"last_week","technicianNames":["Ali"],"completedOnly":true}}\n```',
      ),
    ).toMatchObject({ outcome: "TOOL", toolName: "getJobs" });

    expect(
      parseOperationsPlanContent(
        'Planning complete. {"outcome":"UNSUPPORTED"}',
      ),
    ).toEqual({ outcome: "UNSUPPORTED" });
  });

  it("fails closed when the model invents an unapproved tool", () => {
    expect(
      parseOperationsPlanContent(
        '{"outcome":"TOOL","intent":"JOBS_LOOKUP","toolName":"queryDatabase","arguments":{}}',
      ),
    ).toEqual({ outcome: "UNSUPPORTED" });
  });

  it("still rejects malformed or ambiguous provider objects", () => {
    expect(() => parseOperationsPlanContent('{"outcome":"ANSWER"}')).toThrow();
    expect(() =>
      parseOperationsPlanContent(
        '{"outcome":"UNSUPPORTED"}\n{"outcome":"UNSUPPORTED"}',
      ),
    ).toThrow();
  });

  it("normalizes only null optional arguments before strict tool validation", async () => {
    const planned = await planOperationsRequest(
      provider,
      { question: "What jobs did Ali complete last week?" },
      {
        complete: async () => ({
          content: JSON.stringify({
            outcome: "TOOL",
            intent: "JOBS_LOOKUP",
            toolName: "getJobs",
            arguments: {
              period: "last_week",
              technicianNames: ["Ali"],
              statuses: null,
              serviceTypes: null,
              orderNumbers: null,
              completedOnly: true,
            },
          }),
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            costUsd: null,
          },
        }),
      },
    );

    expect(planned.plan).toMatchObject({
      outcome: "TOOL",
      toolName: "getJobs",
      arguments: {
        period: "last_week",
        technicianNames: ["Ali"],
        completedOnly: true,
        limit: 20,
      },
    });
    expect(
      planned.plan.outcome === "TOOL" && planned.plan.arguments,
    ).not.toHaveProperty("statuses");
  });

  it("accepts a bounded explicit calendar month for every approved period-aware tool", async () => {
    const planned = await planOperationsRequest(
      provider,
      { question: "Which technician completed the most jobs in August 2026?" },
      {
        complete: async () => ({
          content: JSON.stringify({
            outcome: "TOOL",
            toolName: "getTechnicianStats",
            arguments: { period: "month:2026-08", limit: 20 },
          }),
          usage: { promptTokens: 10, completionTokens: 5, costUsd: null },
        }),
      },
    );

    expect(planned.plan).toMatchObject({
      outcome: "TOOL",
      intent: "TECHNICIAN_PERFORMANCE",
      toolName: "getTechnicianStats",
      arguments: { period: "month:2026-08", limit: 20 },
    });
  });

  it("keeps multiple requested orders in one bounded getJobs plan", async () => {
    const planned = await planOperationsRequest(
      provider,
      { question: "Tell me ORD-2026-0038 and ORD-2026-0037" },
      {
        complete: async () => ({
          content: JSON.stringify({
            outcome: "TOOL",
            toolName: "getJobs",
            arguments: {
              orderNumbers: ["ORD-2026-0038", "ORD-2026-0037"],
              completedOnly: false,
              limit: 2,
            },
          }),
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            costUsd: null,
          },
        }),
      },
    );
    expect(planned.plan).toMatchObject({
      outcome: "TOOL",
      intent: "JOBS_LOOKUP",
      toolName: "getJobs",
      arguments: {
        orderNumbers: ["ORD-2026-0038", "ORD-2026-0037"],
        limit: 2,
      },
    });
  });

  it("derives canonical intent from the approved tool name", async () => {
    const planned = await planOperationsRequest(
      provider,
      { question: "How many active jobs do Bala and Ali have this week?" },
      {
        complete: async () => ({
          content: JSON.stringify({
            outcome: "TOOL",
            intent: "TECHNICIAN_WORKLOAD",
            toolName: "getWorkload",
            arguments: {
              period: "this_week",
              technicianNames: ["Bala", "Ali"],
            },
          }),
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            costUsd: null,
          },
        }),
      },
    );
    expect(planned.plan).toMatchObject({
      outcome: "TOOL",
      intent: "WORKLOAD",
      toolName: "getWorkload",
      arguments: { technicianNames: ["Bala", "Ali"] },
    });
  });
});
