import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), runWorkspaceKnowledgeAgent: vi.fn(),
  readGuestAiBudget: vi.fn(), reserveGuestAiCall: vi.fn(), persistWorkspaceAIRecord: vi.fn(),
}));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.persistWorkspaceAIRecord }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({
  readGuestAiBudget: mocks.readGuestAiBudget, reserveGuestAiCall: mocks.reserveGuestAiCall,
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/ai/runtime/workspace-orders-agent", () => ({
  ProviderAllowanceError: class extends Error {
    constructor(public code: string, public resetAt?: string) { super(code); }
  },
}));
vi.mock("@/lib/ai/runtime/workspace-knowledge-agent", () => ({
  runWorkspaceKnowledgeAgent: mocks.runWorkspaceKnowledgeAgent,
  WorkspaceKnowledgeAgentError: class extends Error {
    readonly diagnostics?: unknown;
    constructor(message: string, options?: ErrorOptions & { diagnostics?: unknown }) {
      super(message, options); this.diagnostics = options?.diagnostics;
    }
  },
  WorkspaceKnowledgeAgentAccessError: class extends Error {},
}));
vi.mock("@/lib/services/workspace-knowledge/service", () => ({
  WorkspaceKnowledgeError: class extends Error {
    constructor(public code: string) { super(code); }
  },
}));

import { POST } from "./route";
import { WorkspaceKnowledgeAgentAccessError, WorkspaceKnowledgeAgentError } from "@/lib/ai/runtime/workspace-knowledge-agent";
import { recordAIProviderExchange } from "@/lib/observability/ai-provider-observation-server";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = { authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333", platformRole: "USER",
  isAnonymous: false, membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const url = `http://localhost/api/workspaces/${workspaceId}/agent/knowledge`;
const context = { params: Promise.resolve({ workspaceId }) };
function request(origin = "http://localhost", question: unknown = "When should a cartridge be replaced?") {
  return new Request(url, { method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ question }) });
}

describe("workspace knowledge agent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readGuestAiBudget.mockResolvedValue({ remaining: 20, resetAt: "2026-09-30T16:00:00Z" });
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: { session: "caller" }, guestVisit: null });
    mocks.runWorkspaceKnowledgeAgent.mockResolvedValue({
      status: "EXCERPTS_FOUND", answer: "Source excerpts selected for review.",
      excerpts: [{ text: "Replace after 90 days.", citation: { versionId: "safe-version" } }],
      activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 1 }],
      providerSteps: 2, usage: { inputTokens: 20, outputTokens: 7 },
    });
  });

  it("returns validated excerpts and metadata trace from the actor-scoped run", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ status: "EXCERPTS_FOUND",
      excerpts: [{ text: "Replace after 90 days." }], traceId: expect.any(String) });
    expect(mocks.runWorkspaceKnowledgeAgent).toHaveBeenCalledWith(actor, { session: "caller" },
      { workspaceId, question: "When should a cartridge be replaced?" },
      { abortSignal: expect.any(AbortSignal), beforeProviderCall: undefined,
        onProviderStepStart: expect.any(Function) });
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      task: "WORKSPACE_KNOWLEDGE", status: "SUCCEEDED",
      execution: expect.objectContaining({ providerSteps: 2, inputTokens: 20 }),
    }), actor.profileId);
  });

  it("blocks cross-origin, invalid input, and unverified actors before model access", async () => {
    expect((await POST(request("https://wrong.example"), context)).status).toBe(403);
    expect((await POST(request("http://localhost", " "), context)).status).toBe(400);
    mocks.getWorkspaceRequestContext.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.runWorkspaceKnowledgeAgent).not.toHaveBeenCalled();
    expect(mocks.persistWorkspaceAIRecord).not.toHaveBeenCalled();
  });

  it("allows scoped technician knowledge while blocking preview, revoked and foreign actors", async () => {
    const technician = { ...actor, membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: technician, client: {}, guestVisit: null });
    expect((await POST(request(), context)).status).toBe(200);
    for (const blocked of [
      { ...technician, businessReady: false },
      { ...technician, preview: { readOnly: true, effectiveEmployeeProfileId: actor.profileId } },
      { ...technician, membership: { ...technician.membership, workspaceId: "foreign" } },
    ]) {
      mocks.runWorkspaceKnowledgeAgent.mockClear();
      mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: blocked, client: {}, guestVisit: null });
      expect((await POST(request(), context)).status).toBe(403);
      expect(mocks.runWorkspaceKnowledgeAgent).not.toHaveBeenCalled();
    }
  });

  it("reserves Guest allowance before every paid step and reports exhaustion without source data", async () => {
    const visit = { id: "visit-id", workspaceId, demoGeneration: 3 };
    const demoActor = { ...actor, membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: demoActor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, resetAt: "2026-09-30T16:00:00Z" });
    mocks.runWorkspaceKnowledgeAgent.mockImplementation(async (_actor, _client, _input, options) => {
      await options.beforeProviderCall();
      options.onProviderStepStart(1);
      await options.beforeProviderCall();
      throw new Error("model must not run");
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ resetAt: "2026-09-30T16:00:00Z" });
    expect(mocks.reserveGuestAiCall).toHaveBeenCalledTimes(2);
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      task: "WORKSPACE_KNOWLEDGE", status: "CONTROLLED",
      execution: expect.objectContaining({ guestVisitId: visit.id, providerSteps: 1 }),
    }), demoActor.profileId);
  });

  it("stops an already exhausted Guest before knowledge provider resolution", async () => {
    const visit = { id: "visit-id", workspaceId, demoGeneration: 3 };
    const demoActor = { ...actor, membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: demoActor, client: {}, guestVisit: visit });
    mocks.readGuestAiBudget.mockResolvedValue({ remaining: 0, resetAt: "2026-09-30T16:00:00Z" });
    const response = await POST(request(), context);
    expect(response.status).toBe(429);
    expect(mocks.runWorkspaceKnowledgeAgent).not.toHaveBeenCalled();
    expect(mocks.reserveGuestAiCall).not.toHaveBeenCalled();
  });

  it("returns deterministic uncertainty as a controlled run", async () => {
    mocks.runWorkspaceKnowledgeAgent.mockResolvedValue({ status: "INSUFFICIENT",
      answer: "I could not verify an answer from published knowledge.", excerpts: [],
      activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 0 }], providerSteps: 1, usage: {} });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "INSUFFICIENT", excerpts: [] });
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      status: "CONTROLLED", execution: expect.objectContaining({ providerSteps: 1, failureStage: null }),
    }), actor.profileId);
  });

  it("returns 403 when runtime rejects the actor workspace", async () => {
    mocks.runWorkspaceKnowledgeAgent.mockRejectedValue(new WorkspaceKnowledgeAgentAccessError());
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Forbidden" });
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED", errorCode: "KNOWLEDGE_ACCESS_DENIED",
    }), actor.profileId);
  });

  it("retains safe diagnostics when HTTP 200 provider output causes a runtime failure", async () => {
    mocks.runWorkspaceKnowledgeAgent.mockImplementation(async (_actor, _client, _input, options) => {
      options.onProviderStepStart(1); options.onProviderStepStart(2);
      recordAIProviderExchange({ providerType: "private-provider", endpoint: "https://private.example", model: "private-model",
        method: "POST", statusCode: 200, statusText: "private-status", durationMs: 25,
        request: { headers: { authorization: "private-credential" }, body: { content: "private-question" } },
        response: { headers: {}, body: { choices: [{ finish_reason: "error", message: { content: "private-response" } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } },
          error: { code: 1313, message: "max_tokens exceeds the token budget; private-upstream-message" } } },
        error: { name: "private-error-name", message: "private-error-message" },
      });
      throw new WorkspaceKnowledgeAgentError("private-runtime-message");
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    const body = await response.json();
    const record = mocks.persistWorkspaceAIRecord.mock.calls[0][0];
    expect(record.traceId).toBe(body.traceId);
    expect(record).toMatchObject({ status: "FAILED", errorCode: "KNOWLEDGE_AGENT_UNAVAILABLE", providerCalls: [],
      execution: { providerSteps: 2, finalFinishReason: "error", visibleTextLength: 16, inputTokens: 12,
        outputTokens: 4, reasoningTokens: 2, providerStatusCode: 200, upstreamErrorCode: 1313, providerFailureCategory: "TOKEN_LIMIT" } });
    expect(JSON.stringify(record)).not.toContain("private-");
    expect(JSON.stringify(body)).not.toContain("private-");
  });

  it.each(["TOOL_INPUT_INVALID", "TOOL_QUERY_REJECTED", "KNOWLEDGE_SEARCH_FAILED"] as const)(
    "records %s as FAILED without exposing tool arguments or exceptions", async (failureStage) => {
      mocks.runWorkspaceKnowledgeAgent.mockImplementation(async (_actor, _client, _input, options) => {
        options.onProviderStepStart(1);
        recordAIProviderExchange({ providerType: "private-provider", endpoint: "https://private.example", model: "private-model",
          method: "POST", statusCode: 200, statusText: "private-status", durationMs: 10,
          request: { headers: {}, body: "private-question" },
          response: { headers: {}, body: { choices: [{ finish_reason: "stop", message: { content: "private-text" } }] } } });
        throw new WorkspaceKnowledgeAgentError("private-tool-exception", { diagnostics: {
          failureStage, toolAttempts: failureStage === "TOOL_INPUT_INVALID" ? 0 : 1,
          searchCompleted: 0, invalidToolCalls: failureStage === "TOOL_INPUT_INVALID" ? 1 : 0, toolErrors: 1,
          ...({ args: "private-tool-args", exception: "private-error" } as object),
        } });
      });
      const response = await POST(request(), context);
      expect(response.status).toBe(503);
      const record = mocks.persistWorkspaceAIRecord.mock.calls[0][0];
      expect(record).toMatchObject({ status: "FAILED", execution: { providerSteps: 1, failureStage,
        searchCompleted: 0, toolErrors: 1, finalFinishReason: "stop", visibleTextLength: 12, providerStatusCode: 200 } });
      expect(JSON.stringify(record)).not.toContain("private-");
      expect(JSON.stringify(await response.json())).not.toContain("private-");
    });

  it("keeps unknown exceptions generic and does not trust their diagnostic-shaped properties", async () => {
    mocks.runWorkspaceKnowledgeAgent.mockRejectedValue(Object.assign(new Error("private-exception"), {
      diagnostics: { failureStage: "TOOL_QUERY_REJECTED", toolErrors: 1, args: "private-args" },
    }));
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    const record = mocks.persistWorkspaceAIRecord.mock.calls[0][0];
    expect(record).toMatchObject({ status: "FAILED", execution: { failureStage: null, toolErrors: null } });
    expect(JSON.stringify(record)).not.toContain("private-");
    expect(JSON.stringify(await response.json())).not.toContain("private-");
  });

  it("forwards cancellation and persists only bounded capture metadata after an abort", async () => {
    const controller = new AbortController();
    mocks.runWorkspaceKnowledgeAgent.mockImplementation(async (_actor, _client, _input, options) => {
      options.onProviderStepStart(1);
      recordAIProviderExchange({ providerType: "private-provider", endpoint: "https://private.example", model: "private-model",
        method: "POST", statusCode: 0, statusText: "private-status", durationMs: 10,
        request: { headers: { authorization: "private-credential" }, body: "private-question" },
        response: { headers: {}, body: null }, error: { name: "AbortError", message: "private-abort-message" },
      });
      controller.abort(new Error("private-abort-reason"));
      expect(options.abortSignal.aborted).toBe(true);
      options.abortSignal.throwIfAborted();
    });
    const cancelled = new Request(request(), { signal: controller.signal });
    const response = await POST(cancelled, context);
    expect(response.status).toBe(500);
    const record = mocks.persistWorkspaceAIRecord.mock.calls[0][0];
    expect(record).toMatchObject({ status: "FAILED", execution: { providerSteps: 1, finalFinishReason: "unknown",
      visibleTextLength: 0, providerStatusCode: 0, upstreamErrorCode: null, providerFailureCategory: null } });
    expect(JSON.stringify(record)).not.toContain("private-");
    expect(JSON.stringify(await response.json())).not.toContain("private-");
  });
});
