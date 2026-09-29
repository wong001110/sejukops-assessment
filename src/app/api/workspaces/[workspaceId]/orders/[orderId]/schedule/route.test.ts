import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), reschedule: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/services/workspace-orders/manager-reschedule", () => ({
  rescheduleManagerOrder: mocks.reschedule,
  ManagerRescheduleError: class extends Error {},
}));
import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const route = { params: Promise.resolve({ workspaceId, orderId }) };
function request(origin = "http://localhost", body: object = {
  expectedGeneration: 2, expectedUpdatedAt: "2026-09-29T10:00:00Z", scheduledAt: "2026-09-30T11:00:00Z",
}) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/orders/${orderId}/schedule`, {
    method: "POST", headers: { origin }, body: JSON.stringify(body),
  });
}

describe("Manager schedule route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "a".repeat(43) }) });
  });

  it("denies cross-origin and unauthenticated requests before the command", async () => {
    expect((await POST(request("http://attacker.test"), route)).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
    mocks.context.mockResolvedValueOnce(null);
    expect((await POST(request(), route)).status).toBe(403);
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("forwards only the resolved actor, principal client and matching Guest proof", async () => {
    const actor = { membership: { workspaceId, role: "MANAGER", kind: "DEMO" } };
    const client = { id: "server-held-principal" };
    const visitId = "33333333-3333-4333-8333-333333333333";
    mocks.context.mockResolvedValue({ actor, client, guestVisit: { id: visitId } });
    mocks.reschedule.mockResolvedValue({ id: orderId, scheduled_at: "2026-09-30T11:00:00Z" });
    expect((await POST(request(), route)).status).toBe(200);
    expect(mocks.reschedule).toHaveBeenCalledWith(actor, client, {
      workspaceId, orderId, expectedGeneration: 2,
      expectedUpdatedAt: "2026-09-29T10:00:00Z", scheduledAt: "2026-09-30T11:00:00Z",
    }, { visitId, tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("rejects missing Guest cookie and invalid body", async () => {
    mocks.context.mockResolvedValue({ actor: {}, client: {}, guestVisit: { id: orderId } });
    mocks.cookies.mockResolvedValueOnce({ get: () => undefined });
    expect((await POST(request(), route)).status).toBe(403);
    expect((await POST(request("http://localhost", { expectedGeneration: 2,
      expectedUpdatedAt: "2026-09-29T10:00:00Z", scheduledAt: null }), route)).status).toBe(400);
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("passes null proof for an Owner Manager session", async () => {
    const actor = { membership: { workspaceId, role: "MANAGER", kind: "OWNER" } };
    const client = { id: "owner-client" };
    mocks.context.mockResolvedValue({ actor, client, guestVisit: null });
    mocks.reschedule.mockResolvedValue({ id: orderId });
    expect((await POST(request(), route)).status).toBe(200);
    expect(mocks.reschedule).toHaveBeenCalledWith(actor, client, expect.any(Object), null);
  });
});
