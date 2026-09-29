import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerActorContext: vi.fn(), createServerSupabaseClient: vi.fn(),
  getUser: vi.fn(), updateUser: vi.fn(),
  createClient: vi.fn(), signInWithPassword: vi.fn(), verificationSignOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({
  url: "https://project.example.supabase.co", anonKey: "public-test-key",
}) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { changeOwnerPassword } from "./actions";

const authUserId = "11111111-1111-4111-8111-111111111111";
function form(current = "correct-current", next = "new-password-strong-123") {
  const data = new FormData();
  data.set("currentPassword", current);
  data.set("newPassword", next);
  data.set("confirmation", next);
  return data;
}

describe("Owner password change", () => {
  const initial = { status: "idle" } as const;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerActorContext.mockResolvedValue({
      authUserId, isAnonymous: false, platformRole: "SUPER_ADMIN",
    });
    mocks.getUser.mockResolvedValue({ data: { user: {
      id: authUserId, is_anonymous: false, email: "owner@example.test",
    } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockResolvedValue({ data: {
      user: { id: authUserId }, session: { access_token: "unused-test-token" },
    }, error: null });
    mocks.verificationSignOut.mockResolvedValue({ error: null });
    mocks.createClient.mockReturnValue({ auth: {
      signInWithPassword: mocks.signInWithPassword, signOut: mocks.verificationSignOut,
    } });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
    });
  });

  it("rejects weak or mismatched input without opening Auth", async () => {
    expect(await changeOwnerPassword(initial, form("current", "short")))
      .toEqual({ status: "invalid" });
    const mismatched = form();
    mismatched.set("confirmation", "different-password-123");
    expect(await changeOwnerPassword(initial, mismatched)).toEqual({ status: "invalid" });
    expect(mocks.getServerActorContext).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("denies non-platform actors and a mismatched Auth session", async () => {
    mocks.getServerActorContext.mockResolvedValueOnce({
      authUserId, isAnonymous: false, platformRole: "USER",
    });
    await expect(changeOwnerPassword(initial, form())).rejects.toThrow("REDIRECT:/owner/login");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();

    mocks.getUser.mockResolvedValueOnce({ data: { user: {
      id: "22222222-2222-4222-8222-222222222222", is_anonymous: false,
    } }, error: null });
    await expect(changeOwnerPassword(initial, form())).rejects.toThrow("REDIRECT:/owner/login");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("verifies the old password on an isolated client before updating the bound session", async () => {
    expect(await changeOwnerPassword(initial, form())).toEqual({ status: "changed" });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://project.example.supabase.co", "public-test-key", {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.test", password: "correct-current",
    });
    expect(mocks.verificationSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.updateUser).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledWith({
      current_password: "correct-current", password: "new-password-strong-123",
    });
  });

  it("does not update after a bad password or a mismatched proof account", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null },
      error: new Error("bad credentials") });
    expect(await changeOwnerPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.updateUser).not.toHaveBeenCalled();

    mocks.signInWithPassword.mockResolvedValueOnce({ data: {
      user: { id: "22222222-2222-4222-8222-222222222222" },
      session: { access_token: "unused-test-token" },
    }, error: null });
    expect(await changeOwnerPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.verificationSignOut).toHaveBeenCalledOnce();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("does not update if the temporary proof session cannot be revoked", async () => {
    mocks.verificationSignOut.mockResolvedValue({ error: new Error("cleanup failed") });
    expect(await changeOwnerPassword(initial, form())).toEqual({ status: "failed" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("returns a generic failure without exposing the Auth error", async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error("sensitive Auth details") });
    expect(await changeOwnerPassword(initial, form())).toEqual({ status: "failed" });
  });
});
