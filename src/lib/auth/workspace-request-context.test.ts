import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "./actor-policy";
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), principal: vi.fn(), actor: vi.fn(), visit: vi.fn(), service: vi.fn() }));
// This Node test exercises fresh resolution, not Next's request-cache adapter.
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./guest-principal", () => ({ createGuestPrincipalContext: mocks.principal }));
vi.mock("./guest-session", () => ({ GUEST_COOKIE_NAME: "guest", createGuestServiceClient: mocks.service, resolveGuestVisit: mocks.visit }));
vi.mock("./server-actor", () => ({ getServerActorContext: vi.fn(), resolveActorFromAuthenticatedClient: mocks.actor }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));
import { refreshWorkspaceRequestContext, type WorkspaceRequestContext } from "./workspace-request-context";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const actor: ActorContext = { profileId: "20000000-0000-4000-8000-000000000001", authUserId: "30000000-0000-4000-8000-000000000001", isAnonymous: false,
  platformRole: "USER", sessionId: "bound-server-session", membership: { workspaceId, kind: "DEMO", role: "ADMIN" } };
const visit = { id: "40000000-0000-4000-8000-000000000001", workspaceId, persona: "ADMIN", demoGeneration: 1, expiresAt: "2099-01-01T00:00:00Z" } as const;
const client = { marker: "already-authenticated" } as unknown as SupabaseClient;
const scope: WorkspaceRequestContext = { actor, client, guestVisit: visit };
beforeEach(() => {
  vi.resetAllMocks(); mocks.cookies.mockResolvedValue({ get: () => ({ value: "opaque-visit" }) });
  mocks.actor.mockResolvedValue(actor); mocks.visit.mockResolvedValue(visit); mocks.service.mockReturnValue({ marker: "service" });
});
describe("fresh history authorization on a bound session", () => {
  it("rechecks a fixed Guest principal using the same client/session without another login", async () => {
    const fresh = await refreshWorkspaceRequestContext(scope, workspaceId);
    expect(fresh?.actor.sessionId).toBe("bound-server-session"); expect(fresh?.client).toBe(client);
    expect(mocks.actor).toHaveBeenCalledExactlyOnceWith(client, workspaceId);
    expect(mocks.visit).toHaveBeenCalledWith(expect.anything(), "opaque-visit"); expect(mocks.principal).not.toHaveBeenCalled();
  });
  it.each([null, { ...visit, persona: "TECHNICIAN" }, { ...visit, workspaceId: "50000000-0000-4000-8000-000000000001" }])("denies missing, changed-persona or foreign visits %o", async freshVisit => {
    mocks.visit.mockResolvedValue(freshVisit);
    expect(await refreshWorkspaceRequestContext(scope, workspaceId)).toBeNull();
  });
  it("denies revoked Auth and unavailable Guest service", async () => {
    mocks.actor.mockResolvedValue(null); expect(await refreshWorkspaceRequestContext(scope, workspaceId)).toBeNull();
    mocks.actor.mockResolvedValue(actor); mocks.service.mockReturnValue(null);
    expect(await refreshWorkspaceRequestContext(scope, workspaceId)).toBeNull();
  });
  it("rechecks formal staff without creating a Guest principal and denies mixed identities", async () => {
    const formal = { ...scope, guestVisit: null };
    expect(await refreshWorkspaceRequestContext(formal, workspaceId)).toBeNull();
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect(await refreshWorkspaceRequestContext(formal, workspaceId)).toEqual(formal);
    expect(mocks.principal).not.toHaveBeenCalled(); expect(mocks.visit).not.toHaveBeenCalled();
  });
});
