import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), readGuestAiBudget: vi.fn(), reserveGuestAiCall: vi.fn(),
  isSameOriginRequest: vi.fn(), prepareWorkspaceOrderDraft: vi.fn(), persistWorkspaceAIRecord: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({
  readGuestAiBudget: mocks.readGuestAiBudget, reserveGuestAiCall: mocks.reserveGuestAiCall,
}));
vi.mock("@/lib/auth/demo-entry", () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.persistWorkspaceAIRecord }));
vi.mock("@/lib/services/workspace-order-intake/draft", () => ({
  prepareWorkspaceOrderDraft: mocks.prepareWorkspaceOrderDraft,
  WorkspaceOrderIntakeError: class extends Error {
    constructor(readonly code: string, readonly resetAt?: string) { super(code); }
  },
}));

import { POST } from "./route";
import { recordAIProviderExchange } from "@/lib/observability/ai-provider-observation-server";
import { WorkspaceOrderIntakeError } from "@/lib/services/workspace-order-intake/draft";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "DEMO", role: "ADMIN" },
};
const visit = { id: "44444444-4444-4444-8444-444444444444", workspaceId, demoGeneration: 2 };
const context = { params: Promise.resolve({ workspaceId }) };
function upload(type = "text/plain", content = "Customer: A") {
  const form = new FormData();
  form.set("file", new Blob([content], { type }), "service.txt");
  return new Request("https://example.test/api/workspaces/order-intake/draft", { method: "POST", body: form });
}

describe("order intake draft route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readGuestAiBudget.mockResolvedValue({ remaining: 20, resetAt: "2026-09-30T16:00:00Z" });
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: null });
    mocks.prepareWorkspaceOrderDraft.mockResolvedValue({ draft: {}, generation: 2 });
    mocks.persistWorkspaceAIRecord.mockResolvedValue(undefined);
  });

  it("refuses a missing or wrong-role workspace context before extraction", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce(null);
    expect((await POST(upload(), context)).status).toBe(403);
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce({ actor: {
      ...actor, membership: { ...actor.membership, role: "TECHNICIAN" },
    }, client: {}, guestVisit: null });
    expect((await POST(upload(), context)).status).toBe(403);
    expect(mocks.prepareWorkspaceOrderDraft).not.toHaveBeenCalled();
  });

  it("rejects unsupported files and accepts bounded Owner text for review only", async () => {
    expect((await POST(upload("image/png"), context)).status).toBe(400);
    const request = upload();
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.prepareWorkspaceOrderDraft).toHaveBeenCalledOnce();
    expect(mocks.prepareWorkspaceOrderDraft.mock.calls[0][3].beforeProviderCall).toBeUndefined();
    expect(mocks.prepareWorkspaceOrderDraft.mock.calls[0][3].abortSignal).toBe(request.signal);
    expect(mocks.reserveGuestAiCall).not.toHaveBeenCalled();
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      task: "DOCUMENT_UNDERSTANDING", status: "SUCCEEDED", execution: expect.objectContaining({ providerSteps: 0 }),
    }), actor.profileId);
  });

  it("persists only safe provider metadata for a Guest visit's server-resolved Admin actor", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: true, resetAt: "2026-09-30T16:00:00Z" });
    const extractedText = "EXTRACTED-FILE-CONTENT-SENTINEL";
    const rawKey = "PRIVATE-API-KEY-SENTINEL";
    const rawResponse = `response-${extractedText}`;
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      recordAIProviderExchange({
        providerType: "openai-compatible", providerSource: "SAVED", endpoint: "https://provider.example/v1/chat/completions",
        model: "fictional-model", method: "POST", statusCode: 200, statusText: "OK", durationMs: 34,
        request: { headers: { authorization: `Bearer ${rawKey}` }, body: { messages: [{ content: extractedText }], api_key: rawKey } },
        response: { headers: { "content-type": "application/json" }, body: {
          choices: [{ message: { content: rawResponse }, finish_reason: "stop" }],
          usage: { prompt_tokens: 11, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 3 } },
        } },
      });
      return { draft: {}, generation: 2 };
    });

    const response = await POST(upload("text/plain", "UPLOAD-FILE-CONTENT-SENTINEL"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-sejuk-trace-id")).toMatch(/^[0-9a-f-]{36}$/i);
    const persisted = mocks.persistWorkspaceAIRecord.mock.calls[0][0];
    expect(persisted).toMatchObject({ task: "DOCUMENT_UNDERSTANDING", status: "SUCCEEDED", providerCalls: [], safety: {
      rawPromptPersisted: false, rawProviderResponsePersisted: false, credentialsPersisted: false, documentFieldValuesPersisted: false,
    }, execution: {
      guestVisitId: visit.id, providerSteps: 1, inputTokens: 11, outputTokens: 7,
      finalFinishReason: "stop", visibleTextLength: rawResponse.length, reasoningTokens: 3, providerStatusCode: 200,
    } });
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("UPLOAD-FILE-CONTENT-SENTINEL");
    expect(serialized).not.toContain(extractedText);
    expect(serialized).not.toContain(rawResponse);
    expect(serialized).not.toContain(rawKey);
    expect(serialized).not.toContain("authorization");
  });

  it("records Owner Admin intake in its server-resolved workspace scope", async () => {
    const owner = { ...actor, platformRole: "SUPER_ADMIN", membership: { workspaceId, kind: "OWNER", role: "ADMIN" } } as const;
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: owner, client: {}, guestVisit: null });
    const response = await POST(upload(), context);
    expect(response.status).toBe(200);
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      task: "DOCUMENT_UNDERSTANDING", actorRole: "SUPER_ADMIN", execution: expect.objectContaining({
        workspaceId, workspaceKind: "OWNER", workspaceRole: "ADMIN", guestVisitId: null, providerSteps: 0,
      }),
    }), owner.profileId);
  });

  it("records provider failures with only bounded status metadata", async () => {
    const rawKey = "FAILED-PRIVATE-KEY-SENTINEL";
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async () => {
      recordAIProviderExchange({
        providerType: "openai-compatible", endpoint: "https://provider.example/v1/chat/completions", model: "fictional-model",
        method: "POST", statusCode: 503, statusText: "Unavailable", durationMs: 20,
        request: { headers: { authorization: `Bearer ${rawKey}` }, body: { document: "FAILED-DOCUMENT-SENTINEL" } },
        response: { headers: {}, body: { error: { message: `private ${rawKey} FAILED-DOCUMENT-SENTINEL` } } },
        error: { name: "ProviderError", message: `private ${rawKey} FAILED-DOCUMENT-SENTINEL` },
      });
      throw new WorkspaceOrderIntakeError("UNAVAILABLE");
    });
    const response = await POST(upload(), context);
    expect(response.status).toBe(503);
    const persisted = mocks.persistWorkspaceAIRecord.mock.calls[0][0];
    expect(persisted).toMatchObject({ task: "DOCUMENT_UNDERSTANDING", status: "FAILED", errorCode: "INTAKE_UNAVAILABLE",
      providerCalls: [], execution: { providerSteps: 1, finalFinishReason: "unknown", visibleTextLength: 0, providerStatusCode: 503 } });
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain(rawKey);
    expect(serialized).not.toContain("FAILED-DOCUMENT-SENTINEL");
  });

  it("reserves the shared allowance for a verified Guest visit before extraction", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: true, resetAt: "2026-09-30T16:00:00Z" });
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      return { draft: {}, generation: 2 };
    });
    expect((await POST(upload(), context)).status).toBe(200);
    expect(mocks.reserveGuestAiCall).toHaveBeenCalledExactlyOnceWith(visit);
  });

  it("returns exhaustion without a draft and keeps manual Demo actions available", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue({ allowed: false, resetAt: "2026-09-30T16:00:00Z" });
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      return { draft: {}, generation: 2 };
    });
    const response = await POST(upload(), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("allowance") });
    expect(mocks.persistWorkspaceAIRecord).toHaveBeenCalledWith(expect.objectContaining({
      status: "CONTROLLED", errorCode: "GUEST_AI_EXHAUSTED", providerCalls: [], execution: expect.objectContaining({ providerSteps: 0 }),
    }), actor.profileId);
  });

  it("rejects an already exhausted Guest before preparing document extraction", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.readGuestAiBudget.mockResolvedValue({ remaining: 0, resetAt: "2026-09-30T16:00:00Z" });
    const response = await POST(upload(), context);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ resetAt: "2026-09-30T16:00:00Z" });
    expect(mocks.prepareWorkspaceOrderDraft).not.toHaveBeenCalled();
    expect(mocks.reserveGuestAiCall).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace resolver or Guest allowance is unavailable", async () => {
    mocks.getWorkspaceRequestContext.mockRejectedValueOnce(new Error("Auth unavailable"));
    expect((await POST(upload(), context)).status).toBe(503);
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client: {}, guestVisit: visit });
    mocks.reserveGuestAiCall.mockResolvedValue(null);
    mocks.prepareWorkspaceOrderDraft.mockImplementation(async (_actor, _client, _input, dependencies) => {
      await dependencies.beforeProviderCall();
      return { draft: {}, generation: 2 };
    });
    expect((await POST(upload(), context)).status).toBe(503);
  });
});
