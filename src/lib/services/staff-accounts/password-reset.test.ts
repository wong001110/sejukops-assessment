import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformDataContext } from "@/lib/supabase/platform-server";
import { resetStaffPassword } from "./password-reset";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111", owner: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333", profile: "44444444-4444-4444-8444-444444444444",
  auth: "55555555-5555-4555-8555-555555555555", expected: "66666666-6666-4666-8666-666666666666",
  request: "77777777-7777-4777-8777-777777777777", claim: "88888888-8888-4888-8888-888888888888",
  resetRevision: "99999999-9999-4999-8999-999999999999",
};
const account = {
  profileId: ids.profile, name: "Synthetic Staff", email: "staff@example.test", role: "ADMIN", branchCode: null,
  active: true, passwordChangeRequired: true, authRevision: ids.resetRevision,
};
const reserve = {
  state: "RESERVED", operationId: ids.request, claimToken: ids.claim,
  targetAuthUserId: ids.auth, targetProfileId: ids.profile, resetRevision: ids.resetRevision,
};
const user = { id: ids.auth, email: "staff@example.test", is_anonymous: false, app_metadata: { sejukops_staff_operation: "prior-create-op" } };
const mocks = { rpc: vi.fn(), getUserById: vi.fn(), updateUserById: vi.fn() };
const context = {
  actor: { authUserId: ids.owner, profileId: ids.owner, isAnonymous: false, platformRole: "SUPER_ADMIN",
    businessReady: true, sessionId: ids.session },
  supabase: { rpc: mocks.rpc, auth: { admin: { getUserById: mocks.getUserById, updateUserById: mocks.updateUserById } } },
} as unknown as PlatformDataContext;

describe("staff password reset orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "staff_reserve_password_reset" ? reserve : name === "staff_finalize_password_reset" ? account : null,
      error: null,
    }));
    mocks.getUserById.mockResolvedValueOnce({ data: { user }, error: null }).mockResolvedValueOnce({
      data: { user: { ...user, app_metadata: { ...user.app_metadata, sejukops_staff_password_reset: ids.request } } }, error: null,
    });
    mocks.updateUserById.mockImplementation(async (authUserId: string, attributes: { password: string; app_metadata: Record<string, unknown> }) => ({
      data: { user: { ...user, id: authUserId, app_metadata: attributes.app_metadata } }, error: null,
    }));
  });

  it("rotates Auth only after reservation and finalizes the marked changed password before returning it once", async () => {
    const result = await resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request);
    expect(result.status).toBe("RESET");
    expect(result.account).toEqual(account);
    expect(result.credential?.email).toBe("staff@example.test");
    expect(result.credential?.password.length).toBeGreaterThan(32);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "staff_reserve_password_reset", expect.objectContaining({
      p_owner_auth_user_id: ids.owner, p_owner_session_id: ids.session, p_workspace_id: ids.workspace,
      p_profile_id: ids.profile, p_expected_revision: ids.expected, p_request_key: ids.request,
    }));
    expect(mocks.updateUserById).toHaveBeenCalledOnce();
    const update = mocks.updateUserById.mock.calls[0];
    expect(update[0]).toBe(ids.auth);
    expect(update[1].password).toBe(result.credential?.password);
    expect(update[1].app_metadata).toEqual({ ...user.app_metadata, sejukops_staff_password_reset: ids.request });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "staff_finalize_password_reset", expect.objectContaining({
      p_owner_auth_user_id: ids.owner, p_owner_session_id: ids.session, p_workspace_id: ids.workspace,
      p_profile_id: ids.profile, p_request_key: ids.request, p_claim_token: ids.claim,
    }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUserById.mock.invocationCallOrder[0]);
    expect(mocks.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(result.credential?.password);
  });

  it("returns no credential and makes no Auth call for a completed retry", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { state: "RESET", account }, error: null });
    await expect(resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request)).resolves.toEqual({
      status: "ALREADY_RESET", account, credential: null,
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("reconciles an Auth success after a lost response without replacing or replaying the password", async () => {
    mocks.getUserById.mockReset().mockResolvedValueOnce({ data: { user: { ...user, app_metadata: { ...user.app_metadata, sejukops_staff_password_reset: ids.request } } }, error: null });
    await expect(resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request)).resolves.toEqual({
      status: "ALREADY_RESET", account, credential: null,
    });
    expect(mocks.getUserById).toHaveBeenCalledOnce();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "staff_finalize_password_reset", expect.any(Object));
  });

  it("reconciles a possibly applied Auth error but withholds a password whose application is uncertain", async () => {
    mocks.updateUserById.mockRejectedValueOnce(new Error("synthetic connection reset"));
    await expect(resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request)).resolves.toEqual({
      status: "ALREADY_RESET", account, credential: null,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "staff_finalize_password_reset", expect.any(Object));
  });

  it("does not finalize when Auth identity or operation marker cannot be verified", async () => {
    mocks.getUserById.mockReset().mockResolvedValueOnce({ data: { user: { ...user, id: ids.owner } }, error: null });
    await expect(resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request))
      .rejects.toMatchObject({ status: 503 });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledOnce();

    mocks.rpc.mockClear();
    mocks.getUserById.mockReset().mockResolvedValueOnce({ data: { user }, error: null }).mockResolvedValueOnce({
      data: { user: { ...user, app_metadata: {} } }, error: null,
    });
    await expect(resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request))
      .rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("sanitizes a definitive Auth failure and never sends the generated credential to the ledger", async () => {
    mocks.getUserById.mockReset().mockResolvedValue({ data: { user }, error: null });
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: new Error("synthetic auth secret") });
    await expect(resetStaffPassword(context, ids.workspace, ids.profile, ids.expected, ids.request))
      .rejects.toMatchObject({ code: "STAFF_UNAVAILABLE", status: 503 });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("synthetic auth secret");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("staff_finalize_password_reset");
  });

  it("rejects a non-Owner actor before reserving a reset", async () => {
    const unauthorized = { ...context, actor: { ...context.actor, platformRole: "USER" as const } } as unknown as PlatformDataContext;
    await expect(resetStaffPassword(unauthorized, ids.workspace, ids.profile, ids.expected, ids.request)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});
