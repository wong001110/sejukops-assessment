import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(), getUser: vi.fn(), serverSignOut: vi.fn(),
  createClient: vi.fn(), verificationSignIn: vi.fn(), updateUser: vi.fn(), verificationRpc: vi.fn(), verificationSignOut: vi.fn(),
  finalSignIn: vi.fn(), finalRpc: vi.fn(), finalSignOut: vi.fn(), guestService: vi.fn(), serviceRpc: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({
  url: "https://synthetic-project.example", anonKey: "synthetic-public-key",
}) }));
vi.mock("@/lib/auth/guest-session", () => ({ createGuestServiceClient: mocks.guestService }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { changeStaffPassword } from "./actions";

const authUserId = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const initialSessionId = "33333333-3333-4333-8333-333333333333";
const freshSessionId = "44444444-4444-4444-8444-444444444444";
const claimId = "55555555-5555-4555-8555-555555555555";
const oldPassword = "synthetic-current-password";
const newPassword = "synthetic-new-password-123";
const initial = { status: "idle" } as const;
const actor = {
  authUserId, profileId: "66666666-6666-4666-8666-666666666666", isAnonymous: false,
  platformRole: "USER" as const,
  staff: { passwordChangeRequired: true, sessionAllowed: true, authRevision: revision },
};

function form(current = oldPassword, next = newPassword, confirmation = next) {
  const data = new FormData();
  data.set("currentPassword", current);
  data.set("newPassword", next);
  data.set("confirmation", confirmation);
  return data;
}

const managedStatus = (sessionId: string, authRevision = revision) => ({
  isManaged: true, passwordChangeRequired: true, sessionAllowed: true, authRevision, sessionId,
});

describe("Staff password change action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getServerActorContext.mockResolvedValue(actor);
    mocks.getUser.mockResolvedValue({ data: { user: { id: authUserId, email: "staff@example.test", is_anonymous: false } }, error: null });
    mocks.serverSignOut.mockResolvedValue({ error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getUser: mocks.getUser, signOut: mocks.serverSignOut } });
    mocks.verificationSignIn.mockResolvedValue({ data: { user: { id: authUserId }, session: { access_token: "synthetic-old-session" } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.verificationRpc.mockResolvedValue({ data: managedStatus(initialSessionId), error: null });
    mocks.verificationSignOut.mockResolvedValue({ error: null });
    mocks.finalSignIn.mockResolvedValue({ data: { user: { id: authUserId }, session: { access_token: "synthetic-fresh-session" } }, error: null });
    mocks.finalRpc.mockResolvedValue({ data: managedStatus(freshSessionId), error: null });
    mocks.finalSignOut.mockResolvedValue({ error: null });
    mocks.serviceRpc.mockImplementation((name: string) => {
      if (name === "staff_issue_password_claim") return Promise.resolve({ data: { claimId, expiresAt: "2099-01-01T00:00:00.000Z" }, error: null });
      if (name === "staff_complete_password_change") return Promise.resolve({ data: true, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });
    mocks.guestService.mockReturnValue({ rpc: mocks.serviceRpc });
    mocks.createClient.mockImplementation(() => mocks.createClient.mock.calls.length % 2 === 1
      ? { auth: { signInWithPassword: mocks.verificationSignIn, updateUser: mocks.updateUser, signOut: mocks.verificationSignOut }, rpc: mocks.verificationRpc }
      : { auth: { signInWithPassword: mocks.finalSignIn, signOut: mocks.finalSignOut }, rpc: mocks.finalRpc });
  });

  it("rejects invalid password input before resolving an actor or opening Auth", async () => {
    expect(await changeStaffPassword(initial, form("short", "too-short", "different"))).toEqual({ status: "invalid" });
    expect(mocks.getServerActorContext).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["anonymous", { ...actor, isAnonymous: true }],
    ["platform Super Admin", { ...actor, platformRole: "SUPER_ADMIN" }],
    ["ordinary unmanaged user", { ...actor, staff: undefined }],
    ["session rejected by staff authority", { ...actor, staff: { ...actor.staff, sessionAllowed: false } }],
    ["missing actor", null],
  ])("denies %s before opening an Auth client", async (_label, resolvedActor) => {
    mocks.getServerActorContext.mockResolvedValue(resolvedActor);
    await expect(changeStaffPassword(initial, form())).rejects.toThrow("REDIRECT:/login?error=session");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("requires the current SSR Auth user to match the server-resolved actor", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "77777777-7777-4777-8777-777777777777", email: "other@example.test" } }, error: null });
    await expect(changeStaffPassword(initial, form())).rejects.toThrow("REDIRECT:/login?error=session");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("verifies current password, issues a revision-bound claim, proves the new password in a fresh session, then completes", async () => {
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "changed" });
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
    for (const call of mocks.createClient.mock.calls) {
      expect(call).toEqual(["https://synthetic-project.example", "synthetic-public-key", {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      }]);
    }
    expect(mocks.verificationSignIn).toHaveBeenCalledWith({ email: "staff@example.test", password: oldPassword });
    expect(mocks.updateUser).toHaveBeenCalledWith({ current_password: oldPassword, password: newPassword });
    expect(mocks.serviceRpc).toHaveBeenNthCalledWith(1, "staff_issue_password_claim", {
      p_auth_user_id: authUserId, p_expected_revision: revision, p_actor_session_id: initialSessionId,
    });
    expect(mocks.finalSignIn).toHaveBeenCalledWith({ email: "staff@example.test", password: newPassword });
    expect(mocks.serviceRpc).toHaveBeenNthCalledWith(2, "staff_complete_password_change", {
      p_auth_user_id: authUserId, p_expected_revision: revision,
      p_actor_session_id: freshSessionId, p_claim_id: claimId,
    });
    expect(mocks.verificationSignIn.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUser.mock.invocationCallOrder[0]);
    expect(mocks.updateUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.serviceRpc.mock.invocationCallOrder[0]);
    expect(mocks.serviceRpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.finalSignIn.mock.invocationCallOrder[0]);
    expect(mocks.finalSignIn.mock.invocationCallOrder[0]).toBeLessThan(mocks.serviceRpc.mock.invocationCallOrder[1]);
    expect(mocks.serverSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.verificationSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.finalSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not update after failed current-password authentication", async () => {
    mocks.verificationSignIn.mockResolvedValueOnce({ data: { user: null, session: null }, error: new Error("synthetic auth detail") });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.verificationSignOut).toHaveBeenCalledOnce();
    expect(mocks.finalSignOut).toHaveBeenCalledOnce();
  });

  it("does not update when the current password belongs to a different Auth user", async () => {
    mocks.verificationSignIn.mockResolvedValueOnce({ data: {
      user: { id: "77777777-7777-4777-8777-777777777777" }, session: { access_token: "synthetic-other-session" },
    }, error: null });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.verificationSignOut).toHaveBeenCalledOnce();
    expect(mocks.finalSignOut).toHaveBeenCalledOnce();
  });

  it("never completes when password update, verification status, or claim issuance fails", async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: new Error("synthetic update error") });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();

    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.verificationRpc.mockResolvedValueOnce({ data: null, error: new Error("synthetic status error") });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();

    mocks.verificationRpc.mockResolvedValue({ data: managedStatus(initialSessionId), error: null });
    mocks.serviceRpc.mockResolvedValueOnce({ data: null, error: new Error("synthetic claim error") });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.serviceRpc).toHaveBeenCalledOnce();
    expect(mocks.serviceRpc).not.toHaveBeenCalledWith("staff_complete_password_change", expect.anything());
    expect(mocks.finalSignIn).not.toHaveBeenCalled();
    expect(mocks.verificationSignOut).toHaveBeenCalled();
    expect(mocks.finalSignOut).toHaveBeenCalled();
  });

  it("rejects a mismatched fresh proof and a revision change before completion", async () => {
    mocks.finalSignIn.mockResolvedValueOnce({ data: { user: { id: "88888888-8888-4888-8888-888888888888" }, session: { access_token: "synthetic-other-session" } }, error: null });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.serviceRpc).toHaveBeenCalledOnce();
    expect(mocks.serviceRpc).not.toHaveBeenCalledWith("staff_complete_password_change", expect.anything());

    mocks.finalSignIn.mockResolvedValue({ data: { user: { id: authUserId }, session: { access_token: "synthetic-fresh-session" } }, error: null });
    mocks.finalRpc.mockResolvedValueOnce({ data: managedStatus(freshSessionId, "99999999-9999-4999-8999-999999999999"), error: null });
    expect(await changeStaffPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.serviceRpc).toHaveBeenCalledTimes(2);
    expect(mocks.serviceRpc).not.toHaveBeenCalledWith("staff_complete_password_change", expect.anything());
    expect(mocks.verificationSignOut).toHaveBeenCalled();
    expect(mocks.finalSignOut).toHaveBeenCalled();
  });

  it("leaves the change failed when completion fails and never serializes credentials or Auth errors", async () => {
    mocks.serviceRpc.mockImplementation((name: string) => Promise.resolve(name === "staff_issue_password_claim"
      ? { data: { claimId, expiresAt: "2099-01-01T00:00:00.000Z" }, error: null }
      : { data: null, error: new Error("synthetic completion secret") }));
    const result = await changeStaffPassword(initial, form());
    expect(result).toEqual({ status: "failed" });
    expect(JSON.stringify(result)).not.toContain(oldPassword);
    expect(JSON.stringify(result)).not.toContain(newPassword);
    expect(JSON.stringify(result)).not.toContain("synthetic completion secret");
    expect(mocks.serverSignOut).not.toHaveBeenCalled();
    expect(mocks.verificationSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.finalSignOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
