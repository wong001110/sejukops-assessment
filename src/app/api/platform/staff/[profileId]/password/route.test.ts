import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetStaffPassword: vi.fn(), staffApiContext: vi.fn(), requireStaffOrigin: vi.fn(),
  readStaffJson: vi.fn(), staffResponse: vi.fn(), staffApiError: vi.fn(),
}));
vi.mock("@/lib/services/staff-accounts/password-reset", () => ({ resetStaffPassword: mocks.resetStaffPassword }));
vi.mock("../../_shared", () => ({
  staffApiContext: mocks.staffApiContext, requireStaffOrigin: mocks.requireStaffOrigin,
  readStaffJson: mocks.readStaffJson, staffResponse: mocks.staffResponse, staffApiError: mocks.staffApiError,
}));

import { POST } from "./route";

const profileId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const requestKey = "44444444-4444-4444-8444-444444444444";
const context = { actor: { platformRole: "SUPER_ADMIN" } };

describe("staff password reset API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.staffApiContext.mockResolvedValue(context);
    mocks.readStaffJson.mockResolvedValue({ workspaceId, expectedRevision: revision, requestKey });
    mocks.resetStaffPassword.mockResolvedValue({ status: "RESET", account: {}, credential: { email: "staff@example.test", password: "synthetic-once" } });
    mocks.staffResponse.mockImplementation((body: unknown, status = 200) => Response.json(body, { status }));
    mocks.staffApiError.mockImplementation((error: unknown) => Response.json({ error: String(error) }, {
      status: error instanceof Error && error.message === "forbidden origin" ? 403 : 400,
    }));
  });

  it("checks request origin before resolving Owner context or touching Auth", async () => {
    const failure = new Error("forbidden origin");
    mocks.requireStaffOrigin.mockImplementationOnce(() => { throw failure; });
    const response = await POST(new Request("https://app.example/api", { method: "POST" }), { params: Promise.resolve({ profileId }) });
    expect(mocks.staffApiError).toHaveBeenCalledWith(failure);
    expect(mocks.staffApiContext).not.toHaveBeenCalled();
    expect(mocks.resetStaffPassword).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it("passes only workspace, current revision, request key and path target to the reset service", async () => {
    const response = await POST(new Request("https://app.example/api", { method: "POST" }), { params: Promise.resolve({ profileId }) });
    expect(mocks.requireStaffOrigin).toHaveBeenCalledOnce();
    expect(mocks.staffApiContext).toHaveBeenCalledOnce();
    expect(mocks.readStaffJson).toHaveBeenCalledOnce();
    expect(mocks.resetStaffPassword).toHaveBeenCalledWith(context, workspaceId, profileId, revision, requestKey);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "RESET", account: {}, credential: { email: "staff@example.test", password: "synthetic-once" } });
  });

  it("rejects extra browser fields without invoking the reset service", async () => {
    mocks.readStaffJson.mockResolvedValueOnce({ workspaceId, expectedRevision: revision, requestKey, password: "browser-selected" });
    const response = await POST(new Request("https://app.example/api", { method: "POST" }), { params: Promise.resolve({ profileId }) });
    expect(mocks.staffApiError).toHaveBeenCalledOnce();
    expect(mocks.resetStaffPassword).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });
});
