import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), runWorkspaceKnowledgeAgent: vi.fn(),
  reserveGuestAiCall: vi.fn(), persistWorkspaceAIRecord: vi.fn(),
}));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.persistWorkspaceAIRecord }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ reserveGuestAiCall: mocks.reserveGuestAiCall }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/ai/runtime/workspace-orders-agent", () => ({
  ProviderAllowanceError: class extends Error {
    constructor(public code: string, public resetAt?: string) { super(code); }
  },
}));
vi.mock("@/lib/ai/runtime/workspace-knowledge-agent", () => ({
  runWorkspaceKnowledgeAgent: mocks.runWorkspaceKnowledgeAgent,
  WorkspaceKnowledgeAgentError: class extends Error {},
  WorkspaceKnowledgeAgentAccessError: class extends Error {},
}));
vi.mock("@/lib/services/workspace-knowledge/service", () => ({
  WorkspaceKnowledgeError: class extends Error {
    constructor(public code: string) { super(code); }
  },
}));

import { POST } from "./route";
import { WorkspaceKnowledgeAgentAccessError } from "@/lib/ai/runtime/workspace-knowledge-agent";

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

  it("returns deterministic uncertainty as a controlled run", async () => {
    mocks.runWorkspaceKnowledgeAgent.mockResolvedValue({ status: "INSUFFICIENT",
      answer: "I could not verify an answer from published knowledge.", excerpts: [],
      activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 0 }], providerSteps: 2, usage: {} });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "INSUFFICIENT", excerpts: [] });
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      status: "CONTROLLED",
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
});
