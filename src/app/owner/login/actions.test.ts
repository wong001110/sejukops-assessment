import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  getServerActorContext: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/auth/server-actor", () => ({
  getServerActorContext: mocks.getServerActorContext,
}));

import { signInOwner, signOutOwner } from "./actions";

function credentials() {
  const formData = new FormData();
  formData.set("email", "owner@example.test");
  formData.set("password", "example-password");
  return formData;
}

describe("Owner login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
    });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("rejects invalid input without opening a Supabase client", async () => {
    await expect(signInOwner(new FormData())).rejects.toThrow("REDIRECT:/owner/login?error=invalid");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("signs out a valid Auth user without a platform Super Admin profile", async () => {
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: false, platformRole: "USER" });
    await expect(signInOwner(credentials())).rejects.toThrow("REDIRECT:/owner/login?error=invalid");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("opens the Owner entry only for a verified permanent Super Admin", async () => {
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: false, platformRole: "SUPER_ADMIN" });
    await expect(signInOwner(credentials())).rejects.toThrow("REDIRECT:/owner");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.test",
      password: "example-password",
    });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("clears the server session on sign out", async () => {
    await expect(signOutOwner()).rejects.toThrow("REDIRECT:/owner/login");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
