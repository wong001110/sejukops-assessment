import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  createClient: vi.fn(),
  approve: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({ url: "https://example.supabase.co" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/services/workspace-orders/assignment-proposals", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/workspace-orders/assignment-proposals")>();
  return {
    ...original,
    approveWorkspaceOrderAssignmentFromWeb: mocks.approve,
    executeWorkspaceOrderAssignmentProposal: mocks.execute,
  };
});

import { GET, POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const authUserId = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";
const technicianId = "66666666-6666-4666-8666-666666666666";
const actor = {
  authUserId, profileId, isAnonymous: false, platformRole: "USER",
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" },
};
const row = {
  id: proposalId, workspace_id: workspaceId, initiated_by_profile_id: profileId,
  approver_profile_id: null, status: "PENDING",
  canonical_payload: { orderId, technicianId, scheduledAt: null },
  target_updated_at: "2026-09-28T14:00:00+00:00", dataset_generation: 1,
  expires_at: "2099-01-01T00:00:00+00:00", result_order_updated_at: null,
};
const params = { params: Promise.resolve({ workspaceId, proposalId }) };
const url = `http://localhost/api/workspaces/${workspaceId}/assignment-proposals/${proposalId}`;

function session(proposal = row) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: proposal, error: null });
  const query = { eq: vi.fn(), maybeSingle };
  query.eq.mockReturnValue(query);
  const select = vi.fn().mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, query };
}

describe("assignment proposal human confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-signing-and-service-key");
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.createServerSupabaseClient.mockResolvedValue(session());
    mocks.createClient.mockReturnValue({ rpc: vi.fn() });
    mocks.approve.mockResolvedValue({ status: "APPROVED" });
    mocks.execute.mockResolvedValue({ status: "EXECUTED" });
  });

  it("renders persisted fields then accepts explicit same-user confirmation", async () => {
    const preview = await GET(new Request(url), params);
    expect(preview.status).toBe(200);
    const { proposal, previewToken } = await preview.json();
    expect(proposal.canonicalPayload).toEqual({ orderId, technicianId, scheduledAt: null });
    expect(preview.headers.get("Cache-Control")).toBe("no-store");
    const response = await POST(new Request(url, {
      method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, previewToken }),
    }), params);
    expect(response.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(actor, expect.anything(), { workspaceId, proposalId });
    expect(mocks.execute).toHaveBeenCalledWith(actor, expect.anything(), { workspaceId, proposalId });
  });

  it("rejects missing origin, false confirmation, and forged preview before privileged access", async () => {
    for (const options of [
      { headers: {}, body: { confirm: true, previewToken: "a".repeat(64) } },
      { headers: { origin: "http://localhost" }, body: { confirm: false, previewToken: "a".repeat(64) } },
      { headers: { origin: "http://localhost" }, body: { confirm: true, previewToken: "a".repeat(64) } },
    ]) {
      const response = await POST(new Request(url, {
        method: "POST", headers: options.headers as HeadersInit,
        body: JSON.stringify(options.body),
      }), params);
      expect([400, 403]).toContain(response.status);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("denies another member from approving the initiator's pending proposal", async () => {
    mocks.getServerActorContext.mockResolvedValue({ ...actor, profileId: "77777777-7777-4777-8777-777777777777" });
    const response = await GET(new Request(url), params);
    expect(response.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("denies a signed preview after actor session changes", async () => {
    const preview = await GET(new Request(url), params);
    const { previewToken } = await preview.json();
    mocks.getServerActorContext.mockResolvedValue({ ...actor, authUserId: "88888888-8888-4888-8888-888888888888" });
    const response = await POST(new Request(url, {
      method: "POST", headers: { origin: "http://localhost" },
      body: JSON.stringify({ confirm: true, previewToken }),
    }), params);
    expect(response.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
