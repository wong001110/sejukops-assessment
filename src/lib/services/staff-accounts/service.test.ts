import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformDataContext } from "@/lib/supabase/platform-server";
import { createStaffAccount, staffOwnerParameters, updateStaffAccount } from "./service";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111", owner: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333", request: "44444444-4444-4444-8444-444444444444",
  auth: "55555555-5555-4555-8555-555555555555", profile: "66666666-6666-4666-8666-666666666666",
  claim: "77777777-7777-4777-8777-777777777777", revision: "88888888-8888-4888-8888-888888888888",
};
const input = { name: "Synthetic Admin",email: "synthetic-admin@example.test",role: "ADMIN" as const,branchCode: null };
const account = { profileId: ids.profile,name: input.name,email: input.email,role: input.role,branchCode: null,
  active: true,passwordChangeRequired: true,authRevision: ids.revision };
const reserve = { state: "RESERVED",operationId: ids.request,claimToken: ids.claim,targetAuthUserId: ids.auth,targetProfileId: ids.profile };
const ownAuth = { id: ids.auth,email: input.email,is_anonymous: false,app_metadata: { sejukops_staff_operation: ids.request } };
const mocks = { rpc: vi.fn(),getUserById: vi.fn(),createUser: vi.fn() };
const context = { actor: { authUserId: ids.owner,profileId: ids.owner,isAnonymous: false,platformRole: "SUPER_ADMIN",businessReady: true,sessionId: ids.session },
  supabase: { rpc: mocks.rpc,auth: { admin: { getUserById: mocks.getUserById,createUser: mocks.createUser } } } } as unknown as PlatformDataContext;

describe("staff provisioning orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "staff_reserve_creation" ? reserve : name === "staff_finalize_creation" ? account : null,error: null }));
    mocks.getUserById.mockResolvedValue({ data: { user: null },error: { status: 404 } });
    mocks.createUser.mockResolvedValue({ data: { user: ownAuth },error: null });
  });
  it("creates the reserved identity without email and finalizes before credential delivery", async () => {
    const result = await createStaffAccount(context,ids.workspace,ids.request,input);
    expect(result.account).toEqual(account);
    expect(result.credential?.password.length).toBeGreaterThanOrEqual(24);
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ id: ids.auth,email_confirm: true,
      app_metadata: { sejukops_staff_operation: ids.request } }));
    expect(mocks.rpc).toHaveBeenCalledWith("staff_finalize_creation",expect.objectContaining({ p_claim_token: ids.claim,p_owner_session_id: ids.session }));
    const password = result.credential!.password;
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(password);
  });
  it("returns status without replaying a credential on a completed retry", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { state: "CREATED",account },error: null });
    expect(await createStaffAccount(context,ids.workspace,ids.request,input)).toEqual({ status: "ALREADY_CREATED",account,credential: null });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
  it("reconciles a marked uncertain Auth result without resetting its password", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: ownAuth },error: null });
    const result = await createStaffAccount(context,ids.workspace,ids.request,input);
    expect(result).toEqual({ status: "CREATED",account,credential: null });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it.each([
    { ...ownAuth,app_metadata: {} },
    { ...ownAuth,email: "other@example.test" },
    { ...ownAuth,id: ids.owner },
    { ...ownAuth,is_anonymous: true },
  ])("refuses adoption of a foreign or mismatched Auth identity", async (user) => {
    mocks.getUserById.mockResolvedValue({ data: { user },error: null });
    await expect(createStaffAccount(context,ids.workspace,ids.request,input)).rejects.toMatchObject({ code: "STAFF_CONFLICT" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("staff_finalize_creation");
    expect(mocks.rpc).toHaveBeenCalledWith("staff_fail_creation",expect.objectContaining({ p_request_key: ids.request,p_claim_token: ids.claim }));
  });
  it("quarantines unfinished provisioning and sanitizes underlying errors", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null },error: { message: "synthetic-password-canary" } });
    await expect(createStaffAccount(context,ids.workspace,ids.request,input)).rejects.toThrow("Account creation could not finish. Retry the same request.");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("synthetic-password-canary");
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("staff_finalize_creation");
  });
  it("does not call Auth when the durable reservation conflicts", async () => {
    mocks.rpc.mockResolvedValue({ data: null,error: { message: "STAFF_EMAIL_CONFLICT" } });
    await expect(createStaffAccount(context,ids.workspace,ids.request,input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
  it("rejects ordinary, anonymous, not-ready and missing-session platform identities", () => {
    for (const actor of [
      { ...context.actor,platformRole: "USER" as const },{ ...context.actor,isAnonymous: true },
      { ...context.actor,businessReady: false },{ ...context.actor,sessionId: null },
    ]) expect(() => staffOwnerParameters(actor,ids.workspace)).toThrow();
  });
  it("carries current revision and branch validation into account changes", async () => {
    mocks.rpc.mockResolvedValue({ data: account,error: null });
    await updateStaffAccount(context,ids.workspace,ids.profile,ids.revision,{ role: "ADMIN",branchCode: null,active: false });
    expect(mocks.rpc).toHaveBeenCalledWith("staff_update_account",expect.objectContaining({ p_expected_revision: ids.revision,p_active: false }));
    mocks.rpc.mockClear();
    await expect(updateStaffAccount(context,ids.workspace,ids.profile,ids.revision,{ role: "TECHNICIAN",branchCode: null,active: true })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
