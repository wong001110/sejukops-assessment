import { describe, expect, it } from "vitest";
import { buildWorkspaceAIRecord } from "./workspace-ai-record";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  isAnonymous: false, platformRole: "USER" as const,
  membership: { workspaceId, kind: "DEMO" as const, role: "ADMIN" as const },
};

describe("workspace AI observation metadata", () => {
  it("reports up to five native conversation steps without changing legacy caps", () => {
    const record = buildWorkspaceAIRecord({ task: "WORKSPACE_ORDERS", nativeConversation: true,
      traceId: "44444444-4444-4444-8444-444444444444", actor, workspaceId,
      guestVisitId: null, demoGeneration: null, status: "SUCCEEDED", errorCode: null, durationMs: 1, providerSteps: 5 });
    expect(record.execution).toMatchObject({ flow: "Bounded workspace conversation agent", providerSteps: 5 });
  });
  it("keeps bounded usage and excludes raw input, rows, and secrets", () => {
    const record = buildWorkspaceAIRecord({
      task: "WORKSPACE_ORDERS",
      traceId: "44444444-4444-4444-8444-444444444444", actor, workspaceId,
      guestVisitId: "55555555-5555-4555-8555-555555555555", demoGeneration: 3,
      status: "SUCCEEDED", errorCode: null, durationMs: 821.4,
      providerSteps: 2, inputTokens: 20, outputTokens: 8,
      diagnostics: { finalFinishReason: "length", visibleTextLength: 0, reasoningTokens: 8, upstreamErrorCode: 1313, providerFailureCategory: "TOKEN_LIMIT" },
      question: "private question", orders: ["private order"], secret: "private key",
    } as Parameters<typeof buildWorkspaceAIRecord>[0]);
    expect(record.task).toBe("WORKSPACE_ORDERS");
    expect(record.execution).toMatchObject({ providerSteps: 2, inputTokens: 20, outputTokens: 8 });
    expect(record.durationMs).toBe(821);
    expect(record.execution).toMatchObject({ finalFinishReason: "length", visibleTextLength: 0, reasoningTokens: 8, upstreamErrorCode: 1313, providerFailureCategory: "TOKEN_LIMIT" });
    expect(JSON.stringify(record)).not.toMatch(/private question|private order|private key/);
    expect(record.providerCalls).toEqual([]);
  });

  it("normalizes absent or invalid provider usage", () => {
    const record = buildWorkspaceAIRecord({
      task: "WORKSPACE_KNOWLEDGE",
      traceId: "44444444-4444-4444-8444-444444444444", actor, workspaceId,
      guestVisitId: null, demoGeneration: null, status: "FAILED",
      errorCode: "KNOWLEDGE_AGENT_UNAVAILABLE", durationMs: 0,
      providerSteps: 500, inputTokens: -1,
      diagnostics: { finalFinishReason: "private provider error", visibleTextLength: -1, reasoningTokens: -3,
        upstreamErrorCode: "private-error-code" as unknown as number, providerFailureCategory: "private-error-category",
        failureStage: "private-stage", toolAttempts: -1, searchCompleted: NaN, invalidToolCalls: 1.5,
        toolErrors: "private-error" as unknown as number },
    });
    expect(record.execution).toMatchObject({ providerSteps: 2, inputTokens: null, outputTokens: null });
    expect(record.task).toBe("WORKSPACE_KNOWLEDGE");
    expect(record.execution).toMatchObject({ finalFinishReason: null, visibleTextLength: null, reasoningTokens: null, upstreamErrorCode: null, providerFailureCategory: null });
    expect(record.execution).toMatchObject({ failureStage: null, toolAttempts: null, searchCompleted: null,
      invalidToolCalls: null, toolErrors: null });
    expect(JSON.stringify(record)).not.toContain("private-");
  });

  it("whitelists and bounds knowledge tool diagnostics with no payload fields", () => {
    const record = buildWorkspaceAIRecord({ task: "WORKSPACE_KNOWLEDGE",
      traceId: "44444444-4444-4444-8444-444444444444", actor, workspaceId,
      guestVisitId: null, demoGeneration: null, status: "FAILED", errorCode: "KNOWLEDGE_AGENT_UNAVAILABLE", durationMs: 1,
      diagnostics: { failureStage: "TOOL_QUERY_REJECTED", toolAttempts: 100, searchCompleted: 100,
        invalidToolCalls: 100, toolErrors: 100, ...({ args: "private-args", message: "private-error" } as object) },
    });
    expect(record.execution).toMatchObject({ failureStage: "TOOL_QUERY_REJECTED", toolAttempts: 8, searchCompleted: 1,
      invalidToolCalls: 8, toolErrors: 8, finalFinishReason: null });
    expect(JSON.stringify(record)).not.toContain("private-");
  });
});
