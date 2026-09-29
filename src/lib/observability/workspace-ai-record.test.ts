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
  it("keeps bounded usage and excludes raw input, rows, and secrets", () => {
    const record = buildWorkspaceAIRecord({
      traceId: "44444444-4444-4444-8444-444444444444", actor, workspaceId,
      guestVisitId: "55555555-5555-4555-8555-555555555555", demoGeneration: 3,
      status: "SUCCEEDED", errorCode: null, durationMs: 821.4,
      providerSteps: 2, inputTokens: 20, outputTokens: 8,
      question: "private question", orders: ["private order"], secret: "private key",
    } as Parameters<typeof buildWorkspaceAIRecord>[0]);
    expect(record.task).toBe("WORKSPACE_ORDERS");
    expect(record.execution).toMatchObject({ providerSteps: 2, inputTokens: 20, outputTokens: 8 });
    expect(record.durationMs).toBe(821);
    expect(JSON.stringify(record)).not.toMatch(/private question|private order|private key/);
    expect(record.providerCalls).toEqual([]);
  });

  it("normalizes absent or invalid provider usage", () => {
    const record = buildWorkspaceAIRecord({
      traceId: "44444444-4444-4444-8444-444444444444", actor, workspaceId,
      guestVisitId: null, demoGeneration: null, status: "FAILED",
      errorCode: "WORKSPACE_AGENT_UNAVAILABLE", durationMs: 0,
      providerSteps: 500, inputTokens: -1,
    });
    expect(record.execution).toMatchObject({ providerSteps: 2, inputTokens: null, outputTokens: null });
  });
});
