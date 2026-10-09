import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import type { WorkspaceRequestContext } from "@/lib/auth/workspace-request-context";

const MockAiSessionError = vi.hoisted(() => class MockAiSessionError extends Error { constructor(readonly code: string) { super(code); } });
const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), refreshWorkspaceRequestContext: vi.fn(), getServerActorContext: vi.fn(),
  createGuestServiceClient: vi.fn(), createPlatformDataContext: vi.fn(), readWorkspaceGeneration: vi.fn(),
  canInspectAiSessions: vi.fn(), sessionScope: vi.fn(), readAiSession: vi.fn(), readAiSessions: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext,
  refreshWorkspaceRequestContext: mocks.refreshWorkspaceRequestContext }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.getServerActorContext }));
vi.mock("@/lib/auth/guest-session", () => ({ createGuestServiceClient: mocks.createGuestServiceClient }));
vi.mock("@/lib/supabase/platform-server", () => ({
  createPlatformDataContext: mocks.createPlatformDataContext,
  PlatformPermissionDeniedError: class PlatformPermissionDeniedError extends Error {},
}));
vi.mock("@/lib/services/workspaces/generation", () => ({ readWorkspaceGeneration: mocks.readWorkspaceGeneration }));
vi.mock("@/lib/services/ai-sessions/service", () => ({
  AiSessionError: MockAiSessionError,
  canInspectAiSessions: mocks.canInspectAiSessions, sessionScope: mocks.sessionScope,
  readAiSession: mocks.readAiSession, readAiSessions: mocks.readAiSessions,
}));

import { aiHistoryResponse } from "./ai-session-history";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111", session: "22222222-2222-4222-8222-222222222222",
  cursor: "33333333-3333-4333-8333-333333333333", profile: "44444444-4444-4444-8444-444444444444",
  auth: "55555555-5555-4555-8555-555555555555", visit: "66666666-6666-4666-8666-666666666666",
};
const sample = { sessions: [], nextCursor: null, workspaces: [] };
function actor(role: "ADMIN" | "MANAGER" | "TECHNICIAN" = "MANAGER", overrides: Partial<ActorContext> = {}): ActorContext {
  return { authUserId: ids.auth, profileId: ids.profile, isAnonymous: false, platformRole: "USER", businessReady: true,
    sessionId: ids.auth, staff: { passwordChangeRequired: false, sessionAllowed: true, authRevision: "rev-1" },
    membership: { workspaceId: ids.workspace, kind: "DEMO", role }, ...overrides };
}
function workspaceScope(a = actor(), visitId?: string): WorkspaceRequestContext {
  return { actor: a, client: { marker: "workspace-client" } as never,
    guestVisit: visitId ? { id: visitId, workspaceId: ids.workspace, persona: a.membership?.role ?? "MANAGER", demoGeneration: 7 } as never : null };
}
const url = (query = "") => new Request(`http://local/api/workspaces/${ids.workspace}/ai-sessions${query ? `?${query}` : ""}`);
const detailUrl = () => new Request(`http://local/api/workspaces/${ids.workspace}/ai-sessions/${ids.session}?surface=CHATBOT`);
async function status(response: Response) { return response.status; }

beforeEach(() => {
  vi.resetAllMocks();
  const initial = workspaceScope();
  mocks.getWorkspaceRequestContext.mockResolvedValue(initial);
  mocks.refreshWorkspaceRequestContext.mockResolvedValue(initial);
  mocks.sessionScope.mockImplementation((scope: WorkspaceRequestContext, surface: string) => {
    const a = scope.actor;
    if (!a.membership || a.preview || a.businessReady === false || (a.isAnonymous && !scope.guestVisit) ||
        (surface === "WORKSPACE" && a.membership.role === "TECHNICIAN")) throw new MockAiSessionError("FORBIDDEN");
    return `${a.profileId}:${a.membership.role}:${surface}:${scope.guestVisit?.id ?? "formal"}`;
  });
  mocks.readWorkspaceGeneration.mockResolvedValue(7);
  mocks.createGuestServiceClient.mockReturnValue({ marker: "service-client" });
  mocks.readAiSessions.mockResolvedValue(sample);
  mocks.readAiSession.mockImplementation((_client: unknown, id: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new MockAiSessionError("NOT_FOUND");
    return { session: {}, turns: [] };
  });
  mocks.canInspectAiSessions.mockImplementation((a: ActorContext) => !a.isAnonymous && !a.preview && a.businessReady !== false && a.platformRole === "SUPER_ADMIN");
  const owner = actor("ADMIN", { platformRole: "SUPER_ADMIN", membership: undefined });
  mocks.createPlatformDataContext.mockResolvedValue({ actor: owner, supabase: { marker: "platform-client" } });
  mocks.getServerActorContext.mockResolvedValue(owner);
});

describe("ai history read handler", () => {
  it.each([null, workspaceScope(actor("MANAGER", { businessReady: false })),
    workspaceScope(actor("MANAGER", { preview: { readOnly: true, effectiveEmployeeProfileId: ids.profile } })) ,
    workspaceScope(actor("MANAGER", { isAnonymous: true })),
  ])("denies missing or ineligible current workspace actor %o before reading", async (scope) => {
    mocks.getWorkspaceRequestContext.mockResolvedValue(scope);
    const response = await aiHistoryResponse(url("surface=CHATBOT"), { workspaceId: ids.workspace });
    expect(response.status).toBe(403);
    expect(mocks.readAiSessions).not.toHaveBeenCalled();
    expect(mocks.readAiSession).not.toHaveBeenCalled();
  });

  it("permits Technician CHATBOT history and denies native history", async () => {
    const technician = workspaceScope(actor("TECHNICIAN"));
    mocks.getWorkspaceRequestContext.mockResolvedValue(technician);
    mocks.refreshWorkspaceRequestContext.mockResolvedValue(technician);
    const chat = await aiHistoryResponse(url("surface=CHATBOT"), { workspaceId: ids.workspace });
    expect(chat.status).toBe(200);
    expect(mocks.readAiSessions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      key: `${ids.profile}:TECHNICIAN:CHATBOT:formal`, workspaceId: ids.workspace, generation: 7, surface: "CHATBOT",
    }), ids.workspace, undefined);
    mocks.readAiSessions.mockClear();
    const native = await aiHistoryResponse(url("surface=WORKSPACE"), { workspaceId: ids.workspace });
    expect(native.status).toBe(403);
    expect(mocks.readAiSessions).not.toHaveBeenCalled();
  });

  it("pins Guest history to its server-resolved visit and Demo workspace", async () => {
    const guest = workspaceScope(actor("MANAGER", { isAnonymous: true }), ids.visit);
    mocks.getWorkspaceRequestContext.mockResolvedValue(guest);
    mocks.refreshWorkspaceRequestContext.mockResolvedValue(guest);
    const response = await aiHistoryResponse(url("surface=CHATBOT"), { workspaceId: ids.workspace });
    expect(response.status).toBe(200);
    expect(mocks.readAiSessions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      key: `${ids.profile}:MANAGER:CHATBOT:${ids.visit}`, workspaceId: ids.workspace, generation: 7, surface: "CHATBOT",
    }), ids.workspace, undefined);
  });

  it.each([
    ["profile", workspaceScope(actor("MANAGER", { profileId: "77777777-7777-4777-8777-777777777777" }))],
    ["role/persona", workspaceScope(actor("ADMIN"))],
    ["visit", workspaceScope(actor("MANAGER", { isAnonymous: true }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")],
  ])("rejects a %s scope change after the history query", async (_change, fresh) => {
    mocks.getWorkspaceRequestContext.mockResolvedValue(workspaceScope(actor("MANAGER", { isAnonymous: fresh.actor.isAnonymous }), fresh.guestVisit ? ids.visit : undefined));
    mocks.refreshWorkspaceRequestContext.mockResolvedValue(fresh);
    const response = await aiHistoryResponse(url("surface=CHATBOT"), { workspaceId: ids.workspace });
    expect(response.status).toBe(403);
  });

  it.each([
    ["auth session", { ...actor(), sessionId: "88888888-8888-4888-8888-888888888888" }],
    ["staff auth revision", { ...actor(), staff: { passwordChangeRequired: false, sessionAllowed: true, authRevision: "rev-2" } }],
  ])("rejects a changed %s after reading direct-ID history", async (_change, freshActor) => {
    const initial = workspaceScope();
    mocks.getWorkspaceRequestContext.mockResolvedValue(initial);
    mocks.refreshWorkspaceRequestContext.mockResolvedValue({ ...initial, actor: freshActor });
    const response = await aiHistoryResponse(detailUrl(), { workspaceId: ids.workspace, sessionId: ids.session });
    expect(response.status).toBe(403);
    expect(mocks.readAiSession).toHaveBeenCalledWith(expect.anything(), ids.session, expect.objectContaining({ surface: "CHATBOT" }));
  });

  it("rejects a workspace generation change after the session data was read", async () => {
    mocks.readWorkspaceGeneration.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    const response = await aiHistoryResponse(url("surface=CHATBOT"), { workspaceId: ids.workspace });
    expect(response.status).toBe(403);
    expect(mocks.readAiSessions).toHaveBeenCalledOnce();
  });

  it("rejects malformed non-empty workspace, session, and cursor identifiers before querying", async () => {
    expect(await status(await aiHistoryResponse(url("surface=CHATBOT&cursor=bad"), { workspaceId: ids.workspace }))).toBe(404);
    expect(await status(await aiHistoryResponse(url("workspaceId=bad"), { owner: true }))).toBe(404);
    expect(await status(await aiHistoryResponse(url("surface=CHATBOT"), { workspaceId: ids.workspace, sessionId: "bad" }))).toBe(404);
    expect(mocks.readAiSessions).not.toHaveBeenCalled();
    expect(mocks.readAiSession).toHaveBeenCalledWith(expect.anything(), "bad", expect.objectContaining({ surface: "CHATBOT" }));
  });

  it("rejects explicit empty cursor and workspace filters instead of widening/resetting the read", async () => {
    const statuses = await Promise.all([
      aiHistoryResponse(url("surface=CHATBOT&cursor="), { workspaceId: ids.workspace }).then((response) => response.status),
      aiHistoryResponse(url("workspaceId="), { owner: true }).then((response) => response.status),
    ]);
    expect(statuses).toEqual([404, 404]);
    expect(mocks.readAiSessions).not.toHaveBeenCalled();
  });
});

describe("platform history inspection", () => {
  it("allows only platform Super Admin inspection and rechecks the exact actor session afterward", async () => {
    mocks.canInspectAiSessions.mockReturnValue(false);
    expect(await status(await aiHistoryResponse(new Request("http://local/api/owner/ai-sessions"), { owner: true }))).toBe(403);
    expect(mocks.readAiSessions).not.toHaveBeenCalled();

    mocks.canInspectAiSessions.mockReturnValue(true);
    mocks.createPlatformDataContext.mockResolvedValue({ actor: actor("ADMIN", { platformRole: "SUPER_ADMIN", membership: undefined }), supabase: { marker: "platform-client" } });
    mocks.getServerActorContext.mockResolvedValue(actor("ADMIN", { platformRole: "SUPER_ADMIN", membership: undefined, sessionId: "88888888-8888-4888-8888-888888888888" }));
    const response = await aiHistoryResponse(new Request("http://local/api/owner/ai-sessions"), { owner: true });
    expect(response.status).toBe(403);
    expect(mocks.readAiSessions).toHaveBeenCalledOnce();
  });

  it("routes direct-ID diagnostics through the authorized platform client", async () => {
    const response = await aiHistoryResponse(new Request("http://local/api/owner/ai-sessions"), { owner: true, sessionId: ids.session });
    expect(response.status).toBe(200);
    expect(mocks.readAiSession).toHaveBeenCalledWith({ marker: "platform-client" }, ids.session, null);
  });
});

describe("history routes are read-only", () => {
  it("exports GET only for workspace and platform history endpoints", async () => {
    const workspaceRoute = await import("@/app/api/workspaces/[workspaceId]/ai-sessions/route");
    const workspaceDetail = await import("@/app/api/workspaces/[workspaceId]/ai-sessions/[sessionId]/route");
    const ownerRoute = await import("@/app/api/owner/ai-sessions/route");
    const ownerDetail = await import("@/app/api/owner/ai-sessions/[sessionId]/route");
    for (const route of [workspaceRoute, workspaceDetail, ownerRoute, ownerDetail] as unknown as Array<Record<string, unknown>>) {
      expect(route.GET).toBeTypeOf("function");
      expect(route.POST).toBeUndefined();
      expect(route.PUT).toBeUndefined();
      expect(route.PATCH).toBeUndefined();
      expect(route.DELETE).toBeUndefined();
    }
  });
});
