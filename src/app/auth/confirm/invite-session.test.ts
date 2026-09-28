import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { acceptOwnerInvite, readInviteCredentials } from "./invite-session";

const auth = {
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
};

function inviteAuth() {
  return auth as unknown as Pick<SupabaseClient["auth"], "setSession" | "verifyOtp" | "getUser" | "signOut">;
}

describe("Owner invitation callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.setSession.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({ data: { user: { id: "owner", is_anonymous: false } }, error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it("accepts the default invite fragment and never follows an untrusted next URL", async () => {
    const url = "https://app.example/auth/confirm?next=https://attacker.example/#access_token=token&refresh_token=refresh&type=invite";
    expect(await acceptOwnerInvite(url, inviteAuth())).toBe(true);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "token", refresh_token: "refresh" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("accepts a custom-template invite token hash", async () => {
    const url = "https://app.example/auth/confirm?type=invite&token_hash=abc123";
    expect(await acceptOwnerInvite(url, inviteAuth())).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "abc123" });
  });

  it("rejects other flow types and malformed credentials before Auth calls", async () => {
    expect(readInviteCredentials("https://app.example/auth/confirm#access_token=a&refresh_token=r&type=recovery")).toBeNull();
    expect(readInviteCredentials("https://app.example/auth/confirm?type=recovery&token_hash=abc")).toBeNull();
    expect(await acceptOwnerInvite("https://app.example/auth/confirm?type=invite&token_hash=bad%20hash", inviteAuth())).toBe(false);
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects an unverified or anonymous session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { is_anonymous: true } }, error: null });
    expect(await acceptOwnerInvite("https://app.example/auth/confirm#access_token=a&refresh_token=r", inviteAuth())).toBe(false);
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
