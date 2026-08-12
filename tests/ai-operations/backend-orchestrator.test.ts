import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AIConfigError } from "@/domain/ai-config/errors";
import { AIOperationsError } from "@/domain/ai-operations/errors";
import {
  runAIOperations,
  type AIOperationsRuntimeDependencies,
} from "@/lib/ai/runtime/operations-orchestrator";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers";
import type { AuthorizedDataContext } from "@/lib/supabase/privileged-server";

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

const context = {
  identity: {
    profileId: "00000000-0000-4000-8000-000000001002",
    role: "MANAGER",
    displayName: "Manager Maya",
  },
  supabase: {},
} as unknown as AuthorizedDataContext;

const completion = {
  content: "{}",
  usage: { promptTokens: 10, completionTokens: 4, costUsd: null },
} as const;

describe("AI Operations orchestration", () => {
  it("executes exactly one selected tool and returns deterministic current facts and presentation", async () => {
    const executeTool = vi.fn(async () => ({
      name: "getOperationalSummary" as const,
      arguments: { period: "this_week" as const },
      resultCount: 3,
      result: {
        range: {
          start: "2026-08-09T16:00:00.000Z",
          end: "2026-08-16T16:00:00.000Z",
        },
        completedJobs: 3,
        totalAmount: 830,
      },
    }));
    const telemetry = vi.fn();
    const dependencies: AIOperationsRuntimeDependencies = {
      now: () => new Date("2026-08-11T02:00:00.000Z"),
      createContext: async () => context,
      resolveProvider: async () => provider,
      planner: async () => ({
        plan: {
          outcome: "TOOL",
          intent: "OPERATIONAL_SUMMARY",
          toolName: "getOperationalSummary",
          arguments: { period: "this_week" },
        },
        completion,
      }),
      executeTool,
      onTelemetry: telemetry,
    };

    const result = await runAIOperations(
      { question: "How many jobs were completed this week?" },
      dependencies,
    );

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "ANSWER",
      answer: "3 jobs were completed this week, totaling RM 830.00.",
      presentation: {
        kind: "OPERATIONAL_SUMMARY",
        completedJobs: 3,
        totalAmount: 830,
      },
      metadata: { grounded: true, timezone: "Asia/Kuala_Lumpur" },
    });
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "summary.completed_jobs", value: 3 }),
        expect.objectContaining({ key: "summary.total_amount", value: 830 }),
      ]),
    );
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ toolRounds: 1, usage: completion.usage }),
    );
  });

  it("rejects explicit SQL/destructive boundaries without provider or data access", async () => {
    const createContext = vi.fn(async () => context);
    const resolveProvider = vi.fn(async () => provider);
    const result = await runAIOperations(
      { question: "Execute SQL: SELECT * from every table" },
      { createContext, resolveProvider },
    );
    expect(result.outcome).toBe("UNSUPPORTED");
    expect(result.toolCalls).toEqual([]);
    expect(result.presentation).toBeNull();
    expect(createContext).not.toHaveBeenCalled();
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("normalizes provider auth failures without copying secret-bearing messages", async () => {
    const failure = await runAIOperations(
      { question: "How many jobs were completed today?" },
      {
        createContext: async () => context,
        resolveProvider: async () => {
          throw new AIConfigError(
            "AI_AUTH_FAILED",
            "unsafe provider payload test-key",
            401,
          );
        },
      },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AIOperationsError);
    expect(failure).toMatchObject({
      code: "AI_AUTH_FAILED",
      status: 401,
      retryable: false,
      action: "CONTACT_ADMIN",
    });
    expect((failure as Error).message).not.toContain("test-key");
  });

  it("surfaces a tool failure and never emits a fabricated answer", async () => {
    const failure = await runAIOperations(
      { question: "How many jobs were completed this week?" },
      {
        createContext: async () => context,
        resolveProvider: async () => provider,
        planner: async () => ({
          plan: {
            outcome: "TOOL",
            intent: "OPERATIONAL_SUMMARY",
            toolName: "getOperationalSummary",
            arguments: { period: "this_week" },
          },
          completion,
        }),
        executeTool: async () => {
          throw new Error("database body should not escape");
        },
      },
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "AI_TOOL_FAILED",
      status: 503,
      retryable: true,
    });
    expect((failure as Error).message).not.toContain("database body");
  });
});
