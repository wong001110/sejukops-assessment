import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), cookieToken: "guest-token" as string | undefined,
  confirmWorkspaceOrderIntake: vi.fn(), isSameOriginRequest: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookieToken ? { value: mocks.cookieToken } : undefined }) }));
vi.mock("@/lib/auth/guest-session", () => ({
  GUEST_COOKIE_NAME: "sejukops_guest", isGuestToken: (value: unknown) => value === "guest-token",
  guestTokenHash: () => "a".repeat(64),
}));
vi.mock("@/lib/services/workspace-order-intake/confirm", () => ({
  confirmWorkspaceOrderIntake: mocks.confirmWorkspaceOrderIntake,
}));
vi.mock("@/lib/auth/demo-entry", () => ({ isSameOriginRequest: mocks.isSameOriginRequest }));

import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const body = {
  confirmed: true, expectedGeneration: 2, orderNo: "DOC-001",
  branchId: "44444444-4444-4444-8444-444444444444",
  customer: { mode: "NEW", name: "A", phone: null, address: "1 Demo Street" },
  problemDescription: "Unit leaks", serviceType: "Repair",
};
const request = (payload: unknown) => new Request("https://example.test/api/workspaces/order-intake/confirm", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
const context = { params: Promise.resolve({ workspaceId }) };

describe("order intake confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.cookieToken = "guest-token";
    mocks.getWorkspaceRequestContext.mockResolvedValue({ actor: { profileId: "verified" }, client: {}, guestVisit: null });
  });
  it("rejects cross-origin and missing confirmation without creating a customer or order", async () => {
    mocks.isSameOriginRequest.mockReturnValue(false);
    expect((await POST(request(body), context)).status).toBe(403);
    mocks.isSameOriginRequest.mockReturnValue(true);
    expect((await POST(request({ ...body, confirmed: false }), context)).status).toBe(400);
    expect(mocks.confirmWorkspaceOrderIntake).not.toHaveBeenCalled();
  });
  it("rejects missing actor and sends only reviewed fields to the command", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce(null);
    expect((await POST(request(body), context)).status).toBe(403);
    mocks.confirmWorkspaceOrderIntake.mockResolvedValue({ id: "created-order" });
    const response = await POST(request(body), context);
    expect(response.status).toBe(201);
    expect(mocks.confirmWorkspaceOrderIntake).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), {
        workspaceId, expectedGeneration: 2, orderNo: "DOC-001",
        branchId: body.branchId, customer: body.customer,
        problemDescription: "Unit leaks", serviceType: "Repair",
      }, null,
    );
  });

  it("binds Guest confirmation to the validated visit and cookie proof", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValue({
      actor: { profileId: "verified" }, client: {},
      guestVisit: { id: "55555555-5555-4555-8555-555555555555" },
    });
    mocks.confirmWorkspaceOrderIntake.mockResolvedValue({ id: "created-order" });
    expect((await POST(request(body), context)).status).toBe(201);
    expect(mocks.confirmWorkspaceOrderIntake).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      { visitId: "55555555-5555-4555-8555-555555555555", tokenHash: "a".repeat(64) },
    );
    mocks.cookieToken = undefined;
    expect((await POST(request(body), context)).status).toBe(403);
    expect(mocks.confirmWorkspaceOrderIntake).toHaveBeenCalledTimes(1);
  });
});
