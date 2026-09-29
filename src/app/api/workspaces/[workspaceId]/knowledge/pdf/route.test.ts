import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(),
  extractKnowledgePdfPages: vi.fn(), preflightKnowledgePdfStage: vi.fn(), stageKnowledgePdfText: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/services/workspace-knowledge/service", () => ({
  extractKnowledgePdfPages: mocks.extractKnowledgePdfPages,
  preflightKnowledgePdfStage: mocks.preflightKnowledgePdfStage,
  stageKnowledgePdfText: mocks.stageKnowledgePdfText,
  WorkspaceKnowledgeError: class extends Error {},
}));
import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = { profileId: "verified", membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const documentId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const url = `http://localhost/api/workspaces/${workspaceId}/knowledge/pdf`;
const context = { params: Promise.resolve({ workspaceId }) };
function request(origin = "http://localhost") {
  const form = new FormData();
  form.set("file", new Blob(["%PDF-1.7 fictional"], { type: "application/pdf" }), "guide.pdf");
  form.set("documentId", documentId);
  form.set("generation", "3");
  return new Request(url, { method: "POST", headers: { Origin: origin }, body: form });
}

describe("knowledge PDF intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.createServerSupabaseClient.mockResolvedValue({ session: "caller" });
    mocks.extractKnowledgePdfPages.mockResolvedValue(["Page one", "Page two"]);
    mocks.stageKnowledgePdfText.mockResolvedValue(versionId);
  });

  it("rejects cross-origin and missing actor before parsing or staging", async () => {
    expect((await POST(request("https://evil.example"), context)).status).toBe(403);
    expect(mocks.getServerActorContext).not.toHaveBeenCalled();
    mocks.getServerActorContext.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.extractKnowledgePdfPages).not.toHaveBeenCalled();
  });

  it("stages page-preserving PDF text through the caller-session service", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ versionId, pages: 2 });
    expect(mocks.stageKnowledgePdfText).toHaveBeenCalledWith(
      actor, { session: "caller" },
      { workspaceId, generation: 3, documentId, pages: ["Page one", "Page two"] },
    );
    expect(mocks.preflightKnowledgePdfStage).toHaveBeenCalledWith(actor, { session: "caller" },
      { workspaceId, generation: 3, documentId });
  });

  it("does not parse a PDF for a Technician or failed document preflight", async () => {
    mocks.getServerActorContext.mockResolvedValue({ ...actor, membership: { ...actor.membership, role: "TECHNICIAN" } });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.extractKnowledgePdfPages).not.toHaveBeenCalled();
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.preflightKnowledgePdfStage.mockRejectedValueOnce(new Error("denied"));
    expect((await POST(request(), context)).status).toBe(400);
    expect(mocks.extractKnowledgePdfPages).not.toHaveBeenCalled();
  });
});
