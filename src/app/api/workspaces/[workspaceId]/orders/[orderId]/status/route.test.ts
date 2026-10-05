import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), transition: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/services/workspace-orders/technician-transition", () => ({
  transitionAssignedJob: mocks.transition,
  TechnicianTransitionError: class extends Error {},
}));
import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const route = { params: Promise.resolve({ workspaceId, orderId }) };
function request(origin = "http://localhost", body: object = {
  expectedGeneration: 2, expectedUpdatedAt: "2026-09-29T10:00:00Z", nextStatus: "IN_PROGRESS",
}) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/orders/${orderId}/status`, {
    method: "POST", headers: { origin }, body: JSON.stringify(body),
  });
}

describe("Technician job status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "a".repeat(43) }) });
  });

  it("denies cross-origin and missing identity before command", async () => {
    expect((await POST(request("http://attacker.test"), route)).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
    mocks.context.mockResolvedValueOnce(null);
    expect((await POST(request(), route)).status).toBe(403);
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("forwards only the resolved actor and paired principal client", async () => {
    const actor = { membership: { workspaceId, role: "TECHNICIAN" } };
    const client = { id: "server-held-principal" };
    const visitId = "33333333-3333-4333-8333-333333333333";
    mocks.context.mockResolvedValue({ actor, client, guestVisit: { id: visitId } });
    mocks.transition.mockResolvedValue({ id: orderId, status: "IN_PROGRESS" });
    const response = await POST(request(), route);
    expect(response.status).toBe(200);
    expect(mocks.transition).toHaveBeenCalledWith(actor, client, {
      workspaceId, orderId, expectedGeneration: 2,
      expectedUpdatedAt: "2026-09-29T10:00:00Z", nextStatus: "IN_PROGRESS",
    }, { visitId, tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("rejects Guest context without a valid cookie proof, and passes null for an account", async () => {
    const actor = { membership: { workspaceId, role: "TECHNICIAN" } };
    const client = { id: "owner-client" };
    mocks.context.mockResolvedValue({ actor, client, guestVisit: { id: "33333333-3333-4333-8333-333333333333" } });
    mocks.cookies.mockResolvedValueOnce({ get: () => undefined });
    expect((await POST(request(), route)).status).toBe(403);
    expect(mocks.transition).not.toHaveBeenCalled();

    mocks.context.mockResolvedValue({ actor, client, guestVisit: null });
    mocks.transition.mockResolvedValue({ id: orderId, status: "COMPLETED" });
    expect((await POST(request(), route)).status).toBe(200);
    expect(mocks.transition).toHaveBeenCalledWith(actor, client, expect.any(Object), null);
  });

  it("rejects an invalid transition target at the HTTP boundary", async () => {
    expect((await POST(request("http://localhost", { expectedGeneration: 2,
      expectedUpdatedAt: "2026-09-29T10:00:00Z", nextStatus: "CLOSED" }), route)).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
