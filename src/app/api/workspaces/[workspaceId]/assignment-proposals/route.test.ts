import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  propose: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/services/workspace-orders/assignment-proposals", () => ({
  proposeWorkspaceOrderAssignment: mocks.propose,
  AssignmentProposalError: class extends Error {},
}));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const technicianId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const actor = { authUserId: "55555555-5555-4555-8555-555555555555" };
const url = `http://localhost/api/workspaces/${workspaceId}/assignment-proposals`;
const params = { params: Promise.resolve({ workspaceId }) };
const body = {
  orderId, technicianId, expectedUpdatedAt: "2026-09-28T14:00:00+00:00",
  scheduledAt: null, idempotencyKey,
};

function request(origin: string | null, value: unknown = body) {
  return new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(value),
  });
}

describe("assignment proposal creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc: vi.fn() });
    mocks.propose.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666", status: "PENDING" });
  });

  it("rejects cross-origin and malformed bodies before Auth or database access", async () => {
    expect((await POST(request(null), params)).status).toBe(403);
    expect((await POST(request("https://attacker.example"), params)).status).toBe(403);
    expect((await POST(request("http://localhost", { ...body, role: "ADMIN" }), params)).status).toBe(400);
    expect(mocks.getServerActorContext).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it("rejects an unverified actor and never creates a data client", async () => {
    mocks.getServerActorContext.mockResolvedValue(null);
    expect((await POST(request("http://localhost"), params)).status).toBe(403);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("creates a persisted proposal using only validated fields", async () => {
    const response = await POST(request("http://localhost"), params);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.propose).toHaveBeenCalledWith(actor, expect.anything(), { workspaceId, ...body });
  });
});
