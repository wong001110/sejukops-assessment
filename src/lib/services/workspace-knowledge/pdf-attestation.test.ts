import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...await original<typeof import("@supabase/supabase-js")>(), createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://test.example.supabase.co", anonKey: "public" }),
}));

import { issueKnowledgePdfAttestation, stageKnowledgePdfText } from "./service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "33333333-3333-4333-8333-333333333333";
const claimToken = "77777777-7777-4777-8777-777777777777";
const versionId = "44444444-4444-4444-8444-444444444444";
const actor = {
  authUserId: "55555555-5555-4555-8555-555555555555",
  profileId: "66666666-6666-4666-8666-666666666666",
  isAnonymous: false, platformRole: "USER" as const,
  membership: { workspaceId, kind: "OWNER" as const, role: "ADMIN" as const },
};

describe("PDF page attestation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: claimToken, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("issues a claim with the server-resolved actor and parsed pages", async () => {
    expect(await issueKnowledgePdfAttestation(actor, {
      workspaceId, generation: 2, documentId, pages: ["Page 1", "Page 2"],
    })).toBe(claimToken);
    expect(mocks.createClient).toHaveBeenCalledWith("https://test.example.supabase.co", "server-only-test-key",
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }));
    expect(mocks.rpc).toHaveBeenCalledWith("knowledge_issue_pdf_attestation", {
      p_actor_auth_user_id: actor.authUserId, p_workspace_id: workspaceId,
      p_generation: 2, p_document_id: documentId, p_pages: ["Page 1", "Page 2"],
    });
  });

  it("refuses invalid pages, wrong workspace and missing server credential before issuance", async () => {
    await expect(issueKnowledgePdfAttestation(actor, {
      workspaceId, generation: 2, documentId, pages: [],
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(issueKnowledgePdfAttestation(actor, {
      workspaceId: "22222222-2222-4222-8222-222222222222", generation: 2,
      documentId, pages: ["Text"],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(issueKnowledgePdfAttestation(actor, {
      workspaceId, generation: 2, documentId, pages: ["Text"],
    })).rejects.toMatchObject({ code: "COMMAND_FAILED" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("sends the token and parsed pages for database digest verification", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: versionId, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;
    expect(await stageKnowledgePdfText(actor, supabase, {
      workspaceId, generation: 2, documentId, claimToken, pages: ["Page 1", "Page 2"],
    })).toBe(versionId);
    expect(rpc).toHaveBeenCalledWith("knowledge_consume_pdf_attestation", {
      p_token: claimToken, p_pages: ["Page 1", "Page 2"],
    });
    await expect(stageKnowledgePdfText(actor, supabase, {
      workspaceId, generation: 2, documentId, claimToken: "invalid", pages: ["Page 1"],
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
