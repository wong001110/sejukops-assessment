import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(), getServerActorContext: vi.fn(), readStaffWorkspaceEntry: vi.fn(),
  signInWithPassword: vi.fn(), signOut: vi.fn(), cookieGet: vi.fn(), cookieDelete: vi.fn(),
  guestService: vi.fn(), guestUpdate: vi.fn(), guestEq: vi.fn(), guestIs: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/services/staff-accounts/entry", () => ({ readStaffWorkspaceEntry: mocks.readStaffWorkspaceEntry }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }) }));
vi.mock("@/lib/auth/guest-session", () => ({
  GUEST_COOKIE_NAME: "sejuk_guest_visit",
  isGuestToken: (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value),
  guestTokenHash: () => "synthetic-guest-hash",
  createGuestServiceClient: mocks.guestService,
}));

import { signInStaff, signOutStaff } from "./actions";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const profileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const staffActor = {
  authUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", profileId, isAnonymous: false,
  platformRole: "USER" as const, businessReady: true,
  staff: { passwordChangeRequired: false, sessionAllowed: true, authRevision: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
};

function credentials(extra?: Record<string, string>) {
  const data = new FormData();
  data.set("email", " staff@example.test ");
  data.set("password", "synthetic-password");
  for (const [key, value] of Object.entries(extra ?? {})) data.set(key, value);
  return data;
}

describe("Staff login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: {
      signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut,
    } });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getServerActorContext.mockResolvedValue(staffActor);
    mocks.readStaffWorkspaceEntry.mockResolvedValue(workspaceId);
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.guestIs.mockResolvedValue({ error: null });
    mocks.guestEq.mockReturnValue({ is: mocks.guestIs });
    mocks.guestUpdate.mockReturnValue({ eq: mocks.guestEq });
    mocks.guestService.mockReturnValue({ from: () => ({ update: mocks.guestUpdate }) });
  });

  it("rejects missing email or malformed credentials before creating an Auth session", async () => {
    await expect(signInStaff(new FormData())).rejects.toThrow("REDIRECT:/login?error=invalid");
    await expect(signInStaff(credentials({ email: "not-an-email" }))).rejects.toThrow("REDIRECT:/login?error=invalid");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.getServerActorContext).not.toHaveBeenCalled();
  });

  it("uses only the server-resolved staff actor and the single active workspace", async () => {
    await expect(signInStaff(credentials({ role: "ADMIN", workspaceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })))
      .rejects.toThrow(`REDIRECT:/workspaces/${workspaceId}`);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "staff@example.test", password: "synthetic-password" });
    expect(mocks.getServerActorContext).toHaveBeenCalledOnce();
    expect(mocks.readStaffWorkspaceEntry).toHaveBeenCalledOnce();
    expect(mocks.readStaffWorkspaceEntry).toHaveBeenCalledWith(staffActor, expect.any(Object));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("sends pending staff only to mandatory password change and platform Owner to Owner", async () => {
    mocks.getServerActorContext.mockResolvedValueOnce({
      ...staffActor, staff: { ...staffActor.staff, passwordChangeRequired: true },
    });
    await expect(signInStaff(credentials())).rejects.toThrow("REDIRECT:/account/password");
    expect(mocks.readStaffWorkspaceEntry).not.toHaveBeenCalled();

    mocks.getServerActorContext.mockResolvedValueOnce({ isAnonymous: false, platformRole: "SUPER_ADMIN" });
    await expect(signInStaff(credentials())).rejects.toThrow("REDIRECT:/owner");
    expect(mocks.readStaffWorkspaceEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["anonymous session", { ...staffActor, isAnonymous: true }],
    ["unmanaged account", { ...staffActor, staff: undefined }],
    ["inactive or revoked account", { ...staffActor, staff: { ...staffActor.staff, sessionAllowed: false } }],
    ["missing actor", null],
  ])("signs out and denies an %s", async (_label, actor) => {
    mocks.getServerActorContext.mockResolvedValue(actor);
    await expect(signInStaff(credentials())).rejects.toThrow("REDIRECT:/login?error=invalid");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.readStaffWorkspaceEntry).not.toHaveBeenCalled();
  });

  it("revokes a mixed Guest visit and clears its cookie after staff sign-in", async () => {
    mocks.cookieGet.mockReturnValue({ value: "a".repeat(43) });
    await expect(signInStaff(credentials())).rejects.toThrow(`REDIRECT:/workspaces/${workspaceId}`);
    expect(mocks.guestUpdate).toHaveBeenCalledOnce();
    expect(mocks.guestEq).toHaveBeenCalledWith("token_hash", "synthetic-guest-hash");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sejuk_guest_visit");
  });

  it("fails closed when the server finds no unique active workspace", async () => {
    mocks.readStaffWorkspaceEntry.mockResolvedValue(null);
    await expect(signInStaff(credentials())).rejects.toThrow("REDIRECT:/login?error=invalid");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("clears the local session on explicit sign out", async () => {
    await expect(signOutStaff()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
