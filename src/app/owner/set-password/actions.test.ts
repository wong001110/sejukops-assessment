import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  getServerActorContext: vi.fn(),
  updateUser: vi.fn(),
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

import { setOwnerPassword } from "./actions";

function form(password = "secure-password-123", confirmation = password) {
  const data = new FormData();
  data.set("password", password);
  data.set("confirmation", confirmation);
  return data;
}

describe("Owner password setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: false, platformRole: "SUPER_ADMIN" });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { updateUser: mocks.updateUser, signOut: mocks.signOut } });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("rejects weak or mismatched passwords before touching Auth", async () => {
    await expect(setOwnerPassword(form("short"))).rejects.toThrow("REDIRECT:/owner/set-password?error=invalid");
    await expect(setOwnerPassword(form("secure-password-123", "different-password"))).rejects.toThrow("REDIRECT:/owner/set-password?error=invalid");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("denies a signed-in ordinary user", async () => {
    mocks.getServerActorContext.mockResolvedValue({ isAnonymous: false, platformRole: "USER" });
    await expect(setOwnerPassword(form())).rejects.toThrow("REDIRECT:/owner/login?error=invalid");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("updates only a verified Super Admin session and then signs out", async () => {
    await expect(setOwnerPassword(form())).rejects.toThrow("REDIRECT:/owner/login");
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "secure-password-123" });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("does not claim success when Supabase rejects the password", async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error("rejected") });
    await expect(setOwnerPassword(form())).rejects.toThrow("REDIRECT:/owner/set-password?error=invalid");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
