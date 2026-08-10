import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AIConfigError } from "@/domain/ai-config/errors";
import { explainWorkflowFlag } from "@/lib/services/workflow-supervisor/service";

const FLAG_ID = "00000000-0000-4000-8000-000000007201";
const REQUEST_KEY = "10000000-0000-4000-8000-000000000001";

const baseFlag = {
  id: FLAG_ID,
  orderId: "00000000-0000-4000-8000-000000004030",
  ruleCode: "HIGH_AMOUNT_VARIANCE" as const,
  completionRevision: 1,
  severity: "CRITICAL" as const,
  title: "Final amount is significantly above quote",
  deterministicSummary:
    "The final amount exceeded the configured quoted-price variance threshold.",
  details: {
    quotedPrice: 170,
    extraCharges: 200,
    finalAmount: 370,
    varianceAmount: 200,
    configuredRatio: 0.5,
  },
  status: "OPEN" as const,
  explanation: {
    status: "NOT_REQUESTED" as const,
    summary: null,
    recommendation: null,
    errorCode: null,
    generatedAt: null,
  },
  createdAt: "2026-08-11T01:00:00.000Z",
};

function contextWithRpc(
  rpc: ReturnType<typeof vi.fn>,
) {
  return {
    identity: {
      profileId: "00000000-0000-4000-8000-000000001002",
      role: "MANAGER",
      displayName: "Manager Mei",
    },
    supabase: { rpc },
  } as never;
}

function storedResponse(
  status: "AVAILABLE" | "UNAVAILABLE",
  values: { summary?: string; recommendation?: string; errorCode?: string } = {},
) {
  return {
    flag: {
      ...baseFlag,
      explanation: {
        status,
        summary: values.summary ?? null,
        recommendation: values.recommendation ?? null,
        errorCode: values.errorCode ?? null,
        generatedAt: "2026-08-11T02:00:00.000Z",
      },
    },
    replayed: false,
  };
}

describe("Workflow Supervisor explanation service", () => {
  it("does not spend on a different key while another lease is active", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "WORKFLOW_EXPLANATION_IN_PROGRESS" },
    });
    const resolveProvider = vi.fn();
    const complete = vi.fn();

    await expect(
      explainWorkflowFlag(
        FLAG_ID,
        { requestKey: "10000000-0000-4000-8000-000000000099" },
        {
          createContext: async () => contextWithRpc(rpc),
          resolveProvider,
          complete,
        },
      ),
    ).rejects.toMatchObject({
      code: "WORKFLOW_EXPLANATION_CONFLICT",
      status: 409,
      retryable: true,
    });
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("replays an exact request without resolving or calling a provider", async () => {
    const replay = { ...storedResponse("UNAVAILABLE", { errorCode: "AI_TIMEOUT" }), replayed: true };
    const rpc = vi.fn().mockResolvedValue({
      data: { action: "REPLAY", flag: replay.flag, replayed: true },
      error: null,
    });
    const resolveProvider = vi.fn();
    const complete = vi.fn();

    const result = await explainWorkflowFlag(
      FLAG_ID,
      { requestKey: REQUEST_KEY },
      {
        createContext: async () => contextWithRpc(rpc),
        resolveProvider,
        complete,
      },
    );

    expect(result).toEqual(replay);
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("makes one selected provider call and stores grounded decision support", async () => {
    const saved = storedResponse("AVAILABLE", {
      summary: "The final amount is RM370 compared with the RM170 quote.",
      recommendation: "Review the RM200 variance and attached completion evidence.",
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { action: "EXECUTE", flag: baseFlag, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: saved, error: null });
    const resolveProvider = vi.fn().mockResolvedValue({
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://provider.example/v1",
      model: "bounded-model",
      apiKey: "test-only",
      capabilities: {
        text: true,
        vision: false,
        toolCalling: false,
        structuredOutput: true,
      },
      providerConfigId: "00000000-0000-4000-8000-000000009001",
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        summary: {
          text: saved.flag.explanation.summary,
          factKeys: ["details.finalAmount", "details.quotedPrice"],
        },
        recommendation: {
          text: saved.flag.explanation.recommendation,
          factKeys: ["details.varianceAmount"],
        },
      }),
      usage: { promptTokens: 50, completionTokens: 30, costUsd: null },
    });

    const result = await explainWorkflowFlag(
      FLAG_ID,
      { requestKey: REQUEST_KEY },
      {
        createContext: async () => contextWithRpc(rpc),
        resolveProvider,
        complete,
      },
    );

    expect(result.flag.explanation.status).toBe("AVAILABLE");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(resolveProvider).toHaveBeenCalledWith("WORKFLOW_EXPLANATION");
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      p_explanation_status: "AVAILABLE",
      p_request_key: REQUEST_KEY,
    });
  });

  it("returns and persists UNAVAILABLE while preserving deterministic facts", async () => {
    const saved = storedResponse("UNAVAILABLE", { errorCode: "AI_RATE_LIMITED" });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { action: "EXECUTE", flag: baseFlag, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: saved, error: null });
    const complete = vi.fn().mockRejectedValue(
      new AIConfigError("AI_RATE_LIMITED", "unsafe provider body", 429),
    );

    const result = await explainWorkflowFlag(
      FLAG_ID,
      { requestKey: REQUEST_KEY },
      {
        createContext: async () => contextWithRpc(rpc),
        resolveProvider: async () =>
          ({
            providerType: "OPENAI_COMPATIBLE",
            baseUrl: "https://provider.example/v1",
            model: "bounded-model",
            apiKey: "test-only",
            capabilities: {
              text: true,
              vision: false,
              toolCalling: false,
              structuredOutput: true,
            },
          }) as never,
        complete,
      },
    );

    expect(result.flag.deterministicSummary).toBe(baseFlag.deterministicSummary);
    expect(result.flag.details).toEqual(baseFlag.details);
    expect(result.flag.explanation).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "AI_RATE_LIMITED",
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("rejects invented numeric claims as an unavailable validated response", async () => {
    const saved = storedResponse("UNAVAILABLE", { errorCode: "AI_INVALID_RESPONSE" });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { action: "EXECUTE", flag: baseFlag, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: saved, error: null });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        summary: {
          text: "The final amount is RM999.",
          factKeys: ["details.finalAmount"],
        },
        recommendation: {
          text: "Review the flag.",
          factKeys: ["flag.rule_code"],
        },
      }),
      usage: { promptTokens: null, completionTokens: null, costUsd: null },
    });

    const result = await explainWorkflowFlag(
      FLAG_ID,
      { requestKey: REQUEST_KEY },
      {
        createContext: async () => contextWithRpc(rpc),
        resolveProvider: async () =>
          ({
            providerType: "OPENAI_COMPATIBLE",
            baseUrl: "https://provider.example/v1",
            model: "bounded-model",
            apiKey: "test-only",
            capabilities: {
              text: true,
              vision: false,
              toolCalling: false,
              structuredOutput: true,
            },
          }) as never,
        complete,
      },
    );

    expect(result.flag.explanation.errorCode).toBe("AI_INVALID_RESPONSE");
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      p_explanation_status: "UNAVAILABLE",
      p_error_code: "AI_INVALID_RESPONSE",
    });
  });

  it("rejects ambiguous multiple-object provider output", async () => {
    const saved = storedResponse("UNAVAILABLE", { errorCode: "AI_INVALID_RESPONSE" });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { action: "EXECUTE", flag: baseFlag, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: saved, error: null });
    const complete = vi.fn().mockResolvedValue({
      content:
        '{"summary":{"text":"Review it.","factKeys":["flag.rule_code"]},"recommendation":{"text":"Inspect evidence.","factKeys":["flag.rule_code"]}}\n{"summary":{"text":"Different.","factKeys":["flag.rule_code"]},"recommendation":{"text":"Different.","factKeys":["flag.rule_code"]}}',
      usage: { promptTokens: null, completionTokens: null, costUsd: null },
    });

    const result = await explainWorkflowFlag(
      FLAG_ID,
      { requestKey: REQUEST_KEY },
      {
        createContext: async () => contextWithRpc(rpc),
        resolveProvider: async () =>
          ({
            providerType: "OPENAI_COMPATIBLE",
            baseUrl: "https://provider.example/v1",
            model: "bounded-model",
            apiKey: "test-only",
            capabilities: {
              text: true,
              vision: false,
              toolCalling: false,
              structuredOutput: true,
            },
          }) as never,
        complete,
      },
    );

    expect(result.flag.explanation.errorCode).toBe("AI_INVALID_RESPONSE");
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      p_explanation_status: "UNAVAILABLE",
      p_error_code: "AI_INVALID_RESPONSE",
    });
  });

  it("can resume a DB-authorized stale same-key lease with one bounded call", async () => {
    const saved = storedResponse("UNAVAILABLE", { errorCode: "AI_TIMEOUT" });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        // EXECUTE is also the database result for a stale same-key lease after
        // its bounded lease is renewed under the flag row lock.
        data: { action: "EXECUTE", flag: baseFlag, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: saved, error: null });
    const complete = vi.fn().mockRejectedValue(
      new AIConfigError("AI_TIMEOUT", "safe timeout", 504),
    );

    const result = await explainWorkflowFlag(
      FLAG_ID,
      { requestKey: REQUEST_KEY },
      {
        createContext: async () => contextWithRpc(rpc),
        resolveProvider: async () =>
          ({
            providerType: "OPENAI_COMPATIBLE",
            baseUrl: "https://provider.example/v1",
            model: "bounded-model",
            apiKey: "test-only",
            capabilities: {
              text: true,
              vision: false,
              toolCalling: false,
              structuredOutput: true,
            },
          }) as never,
        complete,
      },
    );

    expect(result.flag.explanation.errorCode).toBe("AI_TIMEOUT");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
