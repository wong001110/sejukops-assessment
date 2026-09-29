import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  service: vi.fn(),
  visit: vi.fn(),
  actor: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({
    url: "https://qobhjvrrpajoyvlgrkbx.supabase.co", anonKey: "public-key",
  }),
}));
vi.mock("./guest-session", () => ({
  createGuestServiceClient: mocks.service,
  resolveGuestVisit: mocks.visit,
}));
vi.mock("./server-actor", () => ({ resolveActorFromAuthenticatedClient: mocks.actor }));

import { createGuestPrincipalContext, deriveGuestPrincipalPassword } from "./guest-principal";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";

function setup(persona: "ADMIN" | "MANAGER" | "TECHNICIAN" = "ADMIN") {
  const signedIn = {
    user: { id: USER, email: `guest-${persona.toLowerCase()}@sejukops.example`, is_anonymous: false },
    session: { access_token: "server-only" },
  };
  const marker = vi.fn().mockResolvedValue({ data: { id: PROFILE, demo_principal: true }, error: null });
  const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle: marker };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  const client = {
    auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: signedIn, error: null }) },
    from: vi.fn().mockReturnValue(builder),
  };
  mocks.createClient.mockReturnValue(client);
  mocks.service.mockReturnValue({ service: true });
  mocks.visit.mockResolvedValue({ id: "visit", workspaceId: WORKSPACE, persona, demoGeneration: 2 });
  mocks.actor.mockResolvedValue({
    authUserId: USER, profileId: PROFILE, isAnonymous: false, platformRole: "USER",
    membership: { workspaceId: WORKSPACE, kind: "DEMO", role: persona },
  });
  return { client, marker };
}

describe("fixed Demo principal adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "private-test-key";
  });

  it("derives separate credentials for each role and project", () => {
    const admin = deriveGuestPrincipalPassword("key", "qobhjvrrpajoyvlgrkbx.supabase.co", "ADMIN");
    expect(admin).toHaveLength(43);
    expect(admin).not.toBe(deriveGuestPrincipalPassword("key", "qobhjvrrpajoyvlgrkbx.supabase.co", "MANAGER"));
    expect(admin).not.toBe(deriveGuestPrincipalPassword("key", "another.supabase.co", "ADMIN"));
    expect(() => deriveGuestPrincipalPassword("", "another.supabase.co", "ADMIN")).toThrow();
  });

  it("validates the visit before opening an authenticated client", async () => {
    setup();
    mocks.visit.mockResolvedValue(null);
    expect(await createGuestPrincipalContext("invalid")).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("resolves the server-stored persona through a Demo-only member", async () => {
    const { client } = setup("TECHNICIAN");
    const context = await createGuestPrincipalContext("opaque-visit");
    expect(context?.actor.membership.role).toBe("TECHNICIAN");
    expect(context?.client).toBe(client);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "guest-technician@sejukops.example", password: expect.any(String),
    });
    expect(mocks.actor).toHaveBeenCalledWith(client, WORKSPACE);
  });

  it("rejects a principal whose membership role differs from the visit", async () => {
    setup("MANAGER");
    mocks.actor.mockResolvedValue({
      authUserId: USER, profileId: PROFILE, isAnonymous: false, platformRole: "USER",
      membership: { workspaceId: WORKSPACE, kind: "DEMO", role: "ADMIN" },
    });
    expect(await createGuestPrincipalContext("opaque-visit")).toBeNull();
  });

  it("rejects Owner, platform, and unmarked profiles", async () => {
    const { marker } = setup();
    mocks.actor.mockResolvedValueOnce({
      authUserId: USER, profileId: PROFILE, isAnonymous: false, platformRole: "SUPER_ADMIN",
      membership: { workspaceId: WORKSPACE, kind: "OWNER", role: "ADMIN" },
    });
    expect(await createGuestPrincipalContext("opaque-visit")).toBeNull();
    marker.mockResolvedValue({ data: { id: PROFILE, demo_principal: false }, error: null });
    expect(await createGuestPrincipalContext("opaque-visit")).toBeNull();
  });

  it("rejects a failed Auth sign-in", async () => {
    const { client } = setup();
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: "INVALID_CREDENTIALS" } });
    expect(await createGuestPrincipalContext("opaque-visit")).toBeNull();
    expect(mocks.actor).not.toHaveBeenCalled();
  });
});
