import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(), getWorkspaceRequestContext: vi.fn(),
  readWorkspaceGeneration: vi.fn(), createKnowledgeDocument: vi.fn(),
  stageKnowledgeText: vi.fn(), publishKnowledgeVersion: vi.fn(),
  indexKnowledgeVersion: vi.fn(), retryKnowledgeIndex: vi.fn(),
  readKnowledgeVersionForReview: vi.fn(), searchWorkspaceKnowledge: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/services/workspaces/generation", () => ({
  readWorkspaceGeneration: mocks.readWorkspaceGeneration,
  WorkspaceGenerationError: class extends Error {},
}));
vi.mock("@/lib/services/workspace-knowledge/service", () => ({
  createKnowledgeDocument: mocks.createKnowledgeDocument,
  stageKnowledgeText: mocks.stageKnowledgeText,
  publishKnowledgeVersion: mocks.publishKnowledgeVersion,
  indexKnowledgeVersion: mocks.indexKnowledgeVersion,
  retryKnowledgeIndex: mocks.retryKnowledgeIndex,
  readKnowledgeVersionForReview: mocks.readKnowledgeVersionForReview,
  searchWorkspaceKnowledge: mocks.searchWorkspaceKnowledge,
  WorkspaceKnowledgeError: class extends Error {},
}));

import { GET, POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const context = { params: Promise.resolve({ workspaceId }) };
const url = `http://localhost/api/workspaces/${workspaceId}/knowledge`;
const actor = { profileId: "verified", isAnonymous: false, businessReady: true,
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };

describe("workspace knowledge API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.createServerSupabaseClient.mockResolvedValue({ session: "caller" });
    mocks.getWorkspaceRequestContext.mockResolvedValue({
      actor, client: { session: "caller" }, guestVisit: null,
    });
    mocks.readWorkspaceGeneration.mockResolvedValue(3);
  });

  it("denies unauthenticated and wrong-workspace requests before opening a client", async () => {
    mocks.getServerActorContext.mockResolvedValue(null);
    mocks.getWorkspaceRequestContext.mockResolvedValue(null);
    const search = await GET(new Request(`${url}?query=cooling`), context);
    const write = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({
      action: "create", generation: 3, title: "Cooling", sourceLabel: "Manual",
    }) }), context);
    expect(search.status).toBe(403);
    expect(write.status).toBe(403);
    expect(mocks.getWorkspaceRequestContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.getServerActorContext).toHaveBeenCalledWith(workspaceId);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("passes the server actor and session client into scoped retrieval", async () => {
    mocks.searchWorkspaceKnowledge.mockResolvedValue([]);
    const response = await GET(new Request(`${url}?query=cooling`), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.searchWorkspaceKnowledge).toHaveBeenCalledWith(
      actor, { session: "caller" }, { workspaceId, query: "cooling" },
    );
  });

  it("allows Guest search but denies Guest review of private source text", async () => {
    const actor = { isAnonymous: true, membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
    const client = { session: "server-held Demo principal" };
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor, client, guestVisit: { id: "guest-visit" } });
    mocks.searchWorkspaceKnowledge.mockResolvedValue([]);

    const search = await GET(new Request(`${url}?query=cooling`), context);
    expect(search.status).toBe(200);
    expect(mocks.searchWorkspaceKnowledge).toHaveBeenCalledWith(actor, client, { workspaceId, query: "cooling" });

    const review = await GET(new Request(`${url}?reviewDocumentId=${documentId}&reviewVersionId=${versionId}`), context);
    expect(review.status).toBe(403);
    expect(mocks.readKnowledgeVersionForReview).not.toHaveBeenCalled();
  });

  it("loads persisted review separately from staging and publishing", async () => {
    mocks.stageKnowledgeText.mockResolvedValue(versionId);
    const stage = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({
      action: "stage", generation: 3, documentId, sourceText: "Cooling text",
    }) }), context);
    expect(stage.status).toBe(201);
    expect(await stage.json()).toEqual({ versionId });
    expect(mocks.publishKnowledgeVersion).not.toHaveBeenCalled();

    mocks.readKnowledgeVersionForReview.mockResolvedValue({ documentId, versionId, sourceText: "Cooling text" });
    const review = await GET(new Request(`${url}?reviewDocumentId=${documentId}&reviewVersionId=${versionId}`), context);
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({ generation: 3, review: { sourceText: "Cooling text" } });
    expect(mocks.readKnowledgeVersionForReview).toHaveBeenCalledWith(
      actor, { session: "caller" }, { workspaceId, generation: 3, documentId, versionId },
    );

    const publish = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({
      action: "publish", generation: 3, documentId, versionId,
    }) }), context);
    expect(publish.status).toBe(200);
    expect(mocks.publishKnowledgeVersion).toHaveBeenCalledOnce();
  });

  it("rejects malformed bodies and incomplete review IDs", async () => {
    const malformed = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: "{" }), context);
    const extra = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({
      action: "publish", generation: 3, documentId, versionId, role: "ADMIN",
    }) }), context);
    const review = await GET(new Request(`${url}?reviewDocumentId=${documentId}`), context);
    expect([malformed.status, extra.status, review.status]).toEqual([400, 400, 400]);
    expect(mocks.publishKnowledgeVersion).not.toHaveBeenCalled();
    expect(mocks.readKnowledgeVersionForReview).not.toHaveBeenCalled();
  });

  it("keeps indexing and retry as separate, generation-bound commands", async () => {
    const input = { generation: 3, documentId, versionId };
    const send = (action: "index" | "retry") => POST(new Request(url, {
      method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ action, ...input }),
    }), context);
    expect((await send("index")).status).toBe(200);
    expect(mocks.indexKnowledgeVersion).toHaveBeenCalledWith(
      actor, { session: "caller" }, { workspaceId, ...input, action: "index" },
    );
    expect(mocks.publishKnowledgeVersion).not.toHaveBeenCalled();
    expect((await send("retry")).status).toBe(200);
    expect(mocks.retryKnowledgeIndex).toHaveBeenCalledOnce();
  });
});
