import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "@/lib/auth/actor-policy";
import type { WorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { readAiSessionId } from "@/domain/ai-sessions/contracts";

const guestClient = vi.hoisted(() => ({ rpc: vi.fn() }));
const mocks = vi.hoisted(() => ({ createGuestServiceClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guest-session", () => ({ createGuestServiceClient: mocks.createGuestServiceClient }));

import { AiSessionError, beginAiSessionTurn, canInspectAiSessions, finishAiSessionTurn, readAiSession, readAiSessions, sessionScope } from "./service";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  otherWorkspace: "22222222-2222-4222-8222-222222222222",
  profile: "33333333-3333-4333-8333-333333333333",
  otherProfile: "44444444-4444-4444-8444-444444444444",
  session: "55555555-5555-4555-8555-555555555555",
  turn: "66666666-6666-4666-8666-666666666666",
  cursor: "77777777-7777-4777-8777-777777777777",
};
const now = "2026-10-09T12:00:00.000Z";
const sessionRow = {
  id: ids.session, workspace_id: ids.workspace, workspace_kind: "DEMO", generation: 7,
  profile_id: ids.profile, scope_key: `${ids.profile}:MANAGER:CHATBOT:formal`,
  title: "Filter inspection", surface: "CHATBOT", role: "MANAGER", created_at: now, updated_at: now, turn_count: 1,
};
const workspaceRow = { id: ids.workspace, kind: "DEMO", name: "Demo", generation: 7, active: true };

function actor(role: "ADMIN" | "MANAGER" | "TECHNICIAN" = "MANAGER", overrides: Partial<ActorContext> = {}): ActorContext {
  return { authUserId: ids.profile, profileId: ids.profile, isAnonymous: false, platformRole: "USER", businessReady: true,
    sessionId: "88888888-8888-4888-8888-888888888888", staff: { passwordChangeRequired: false, sessionAllowed: true, authRevision: "rev-1" },
    membership: { workspaceId: ids.workspace, kind: "DEMO", role }, ...overrides };
}
function scope(a = actor(), visit: WorkspaceRequestContext["guestVisit"] = null): WorkspaceRequestContext {
  return { actor: a, client: {} as SupabaseClient, guestVisit: visit };
}
function guestVisit(id = "99999999-9999-4999-8999-999999999999", persona: "ADMIN" | "MANAGER" | "TECHNICIAN" = "MANAGER") {
  return { id, workspaceId: ids.workspace, persona, demoGeneration: 7 } as NonNullable<WorkspaceRequestContext["guestVisit"]>;
}

type QueryCall = { table: string; method: string; args: unknown[] };
function queryClient(data: Record<string, unknown[]>, errors: Record<string, unknown> = {}) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    const filters: QueryCall[] = [];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "or", "lt", "order", "limit"]) {
      query[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        if (["eq", "in", "or", "lt"].includes(method)) filters.push({ table, method, args });
        return query;
      };
    }
    const matches = (row: Record<string, unknown>) => filters.every(({ method, args }) => {
      if (method === "eq") return row[String(args[0])] === args[1];
      if (method === "in") return (args[1] as unknown[]).includes(row[String(args[0])]);
      if (method === "lt") return String(row[String(args[0])]) < String(args[1]);
      return true;
    });
    const result = () => {
      const error = errors[table] ?? null;
      return { data: error ? null : (data[table] ?? []).filter((row) => matches(row as Record<string, unknown>)), error };
    };
    query.maybeSingle = async () => {
      const resolved = result();
      return { data: resolved.data?.[0] ?? null, error: resolved.error };
    };
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, from, calls };
}
function rpcResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  return { abortSignal() { return this; }, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createGuestServiceClient.mockReturnValue(guestClient);
  guestClient.rpc.mockImplementation(() => rpcResult("RECORDED"));
});

describe("AI conversation session scope", () => {
  it.each([
    ["missing membership", actor("MANAGER", { membership: undefined })],
    ["preview actor", actor("MANAGER", { preview: { readOnly: true, effectiveEmployeeProfileId: ids.otherProfile } })],
    ["incomplete business actor", actor("MANAGER", { businessReady: false })],
    ["anonymous actor without visit", actor("MANAGER", { isAnonymous: true })],
  ])("denies %s", (_label, denied) => {
    expect(() => sessionScope(scope(denied), "CHATBOT")).toThrowError(AiSessionError);
    expect(() => sessionScope(scope(denied), "WORKSPACE")).toThrowError(AiSessionError);
  });

  it("allows a Technician's CHATBOT scope while denying native workspace history", () => {
    const technician = scope(actor("TECHNICIAN"));
    expect(sessionScope(technician, "CHATBOT")).toBe(`${ids.profile}:TECHNICIAN:CHATBOT:formal`);
    expect(() => sessionScope(technician, "WORKSPACE")).toThrowError(AiSessionError);
  });

  it("isolates Guest visit, profile, and persona scopes", () => {
    const visitId = "99999999-9999-4999-8999-999999999999";
    const first = sessionScope(scope(actor("MANAGER", { isAnonymous: true }), guestVisit(visitId)), "CHATBOT");
    expect(first).toBe(`${ids.profile}:MANAGER:CHATBOT:${visitId}`);
    expect(sessionScope(scope(actor("MANAGER", { profileId: ids.otherProfile, isAnonymous: true }), guestVisit(visitId)), "CHATBOT")).not.toBe(first);
    expect(sessionScope(scope(actor("MANAGER", { isAnonymous: true }), guestVisit("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")), "CHATBOT")).not.toBe(first);
    expect(sessionScope(scope(actor("ADMIN", { isAnonymous: true }), guestVisit(visitId, "ADMIN")), "CHATBOT")).not.toBe(first);
    expect(() => sessionScope(scope(actor("MANAGER", { isAnonymous: true, membership: { workspaceId: ids.workspace, kind: "OWNER", role: "MANAGER" } }), guestVisit(visitId)), "CHATBOT")).toThrowError(AiSessionError);
    expect(() => sessionScope(scope(actor("MANAGER", { isAnonymous: true }), { ...guestVisit(visitId), workspaceId: ids.otherWorkspace }), "CHATBOT")).toThrowError(AiSessionError);
    expect(() => sessionScope(scope(actor("MANAGER", { isAnonymous: true }), guestVisit(visitId, "ADMIN")), "CHATBOT")).toThrowError(AiSessionError);
  });

  it("allows only a ready, non-preview platform Super Admin to inspect sessions", () => {
    expect(canInspectAiSessions(actor("ADMIN", { platformRole: "SUPER_ADMIN", membership: undefined }))).toBe(true);
    expect(canInspectAiSessions(actor("ADMIN"))).toBe(false);
    expect(canInspectAiSessions(actor("ADMIN", { platformRole: "SUPER_ADMIN", isAnonymous: true }))).toBe(false);
    expect(canInspectAiSessions(actor("ADMIN", { platformRole: "SUPER_ADMIN", preview: { readOnly: true, effectiveEmployeeProfileId: null } }))).toBe(false);
    expect(canInspectAiSessions(actor("ADMIN", { platformRole: "SUPER_ADMIN", businessReady: false }))).toBe(false);
  });
});

describe("server-authored session journal", () => {
  it("keeps the session header optional for clients that do not opt into history", () => {
    expect(readAiSessionId(new Request("http://local/api/operations/ask"))).toBeUndefined();
    expect(() => readAiSessionId(new Request("http://local/api/operations/ask", { headers: { "X-Sejuk-Session": "invalid" } }))).toThrow();
  });

  it("keeps old callers optional and rejects invalid correlation IDs before calling persistence", async () => {
    await expect(beginAiSessionTurn(scope(), "CHATBOT", 7, undefined, ids.turn, "question")).resolves.toBeNull();
    await expect(beginAiSessionTurn(scope(), "CHATBOT", 7, "not-a-uuid", ids.turn, "question")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(beginAiSessionTurn(scope(), "CHATBOT", 7, ids.session, "not-a-uuid", "question")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.createGuestServiceClient).not.toHaveBeenCalled();
  });

  it("records only server-resolved identity, role, surface, and generation", async () => {
    const technician = scope(actor("TECHNICIAN"));
    const journal = await beginAiSessionTurn(technician, "CHATBOT", 7, ids.session, ids.turn, "Filter inspection");
    expect(journal).toMatchObject({ sessionId: ids.session, turnId: ids.turn, generation: 7, scopeKey: `${ids.profile}:TECHNICIAN:CHATBOT:formal` });
    expect(guestClient.rpc).toHaveBeenCalledExactlyOnceWith("ai_session_turn_begin", expect.objectContaining({
      p_session_id: ids.session, p_turn_id: ids.turn, p_workspace_id: ids.workspace, p_profile_id: ids.profile,
      p_scope_key: `${ids.profile}:TECHNICIAN:CHATBOT:formal`, p_role: "TECHNICIAN", p_surface: "CHATBOT", p_generation: 7,
      p_question: "Filter inspection",
    }));
    await expect(beginAiSessionTurn(technician, "WORKSPACE", 7, ids.session, ids.turn, "Native question")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([["FORBIDDEN", "FORBIDDEN"], ["BUSY", "BUSY"], ["LIMIT", "LIMIT"]] as const)("preserves server refusal %s", async (reply, code) => {
    guestClient.rpc.mockImplementationOnce(() => rpcResult(reply));
    await expect(beginAiSessionTurn(scope(), "CHATBOT", 7, ids.session, ids.turn, "question")).rejects.toMatchObject({ code });
  });

  it.each(["COMPLETED", "FAILED", "INTERRUPTED"] as const)("persists a validated server terminal output as %s", async (status) => {
    const journal = { sessionId: ids.session, turnId: ids.turn, client: guestClient as unknown as SupabaseClient, generation: 7,
      scopeKey: `${ids.profile}:MANAGER:CHATBOT:formal` };
    guestClient.rpc.mockImplementationOnce(() => rpcResult(true));
    await expect(finishAiSessionTurn(journal, { answer: status === "COMPLETED" ? "Verified answer" : null, workspace: null, activity: [] }, status)).resolves.toBe(true);
    expect(guestClient.rpc).toHaveBeenCalledWith("ai_session_turn_finish", expect.objectContaining({
      p_turn_id: ids.turn, p_session_id: ids.session, p_scope_key: journal.scopeKey, p_generation: 7, p_status: status,
      p_answer: status === "COMPLETED" ? "Verified answer" : null, p_workspace_snapshot: null, p_activity: [],
    }));
  });

  it("does not call the database for a missing journal and rejects oversized terminal output", async () => {
    await expect(finishAiSessionTurn(null, { answer: null, workspace: null, activity: [] }, "FAILED")).resolves.toBe(false);
    const journal = { sessionId: ids.session, turnId: ids.turn, client: guestClient as unknown as SupabaseClient, generation: 7, scopeKey: "scope" };
    await expect(finishAiSessionTurn(journal, { answer: "x".repeat(6001), workspace: null, activity: [] }, "COMPLETED")).rejects.toThrow();
    expect(guestClient.rpc).not.toHaveBeenCalled();
  });
});

describe("history query scoping", () => {
  const personal = { key: `${ids.profile}:MANAGER:CHATBOT:formal`, workspaceId: ids.workspace, generation: 7, surface: "CHATBOT" as const };
  it("accepts PostgREST UTC offsets for session and turn timestamps", async () => {
    const offset = "2026-10-09T12:00:00.123456+00:00";
    const fake = queryClient({ workspaces: [workspaceRow], ai_chat_sessions: [{ ...sessionRow, created_at: offset, updated_at: offset }],
      ai_chat_turns: [{ id: ids.turn, session_id: ids.session, question: "Question", status: "COMPLETED", answer: "Answer", created_at: offset, completed_at: offset, workspace_snapshot: null, activity: [] }] });
    const detail = await readAiSession(fake.client, ids.session, personal);
    expect(detail.session.createdAt).toBe(offset); expect(detail.turns[0].completedAt).toBe(offset);
  });
  it("filters list reads by workspace, generation, scope, and surface and rejects malformed IDs", async () => {
    const fake = queryClient({ workspaces: [workspaceRow], ai_chat_sessions: [sessionRow] });
    const result = await readAiSessions(fake.client, personal, ids.workspace, ids.session);
    expect(result.sessions).toHaveLength(1);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { table: "ai_chat_sessions", method: "in", args: ["workspace_id", [ids.workspace]] },
      { table: "ai_chat_sessions", method: "eq", args: ["scope_key", personal.key] },
      { table: "ai_chat_sessions", method: "eq", args: ["generation", 7] },
      { table: "ai_chat_sessions", method: "eq", args: ["surface", "CHATBOT"] },
      { table: "ai_chat_sessions", method: "eq", args: ["id", ids.session] },
      { table: "ai_chat_sessions", method: "order", args: ["created_at", { ascending: false }] },
      { table: "ai_chat_sessions", method: "order", args: ["id", { ascending: false }] },
      { table: "ai_chat_sessions", method: "or", args: [`and(or(and(workspace_id.eq.${ids.workspace},generation.eq.7)),or(created_at.lt.${now},and(created_at.eq.${now},id.lt.${ids.session})))`] },
    ]));
    await expect(readAiSessions(fake.client, personal, "bad-workspace")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readAiSessions(fake.client, personal, ids.workspace, "bad-cursor")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a cursor outside the caller's filtered scope before loading a page", async () => {
    const foreign = { ...sessionRow, id: ids.cursor, scope_key: `${ids.otherProfile}:MANAGER:CHATBOT:formal` };
    const fake = queryClient({ workspaces: [workspaceRow], ai_chat_sessions: [sessionRow, foreign] });
    await expect(readAiSessions(fake.client, personal, ids.workspace, ids.cursor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.calls.filter(({ table, method }) => table === "ai_chat_sessions" && method === "order")).toEqual([]);
  });

  it("constrains platform lists to the current active Demo and Owner workspace generations", async () => {
    const ownerWorkspace = { ...workspaceRow, id: ids.otherWorkspace, kind: "OWNER", generation: 3, name: "Owner" };
    const fake = queryClient({ workspaces: [workspaceRow, ownerWorkspace], ai_chat_sessions: [sessionRow] });
    await readAiSessions(fake.client, null);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { table: "workspaces", method: "eq", args: ["active", true] },
      { table: "workspaces", method: "in", args: ["kind", ["DEMO", "OWNER"]] },
      { table: "ai_chat_sessions", method: "in", args: ["workspace_id", [ids.workspace, ids.otherWorkspace]] },
      { table: "ai_chat_sessions", method: "or", args: [`and(workspace_id.eq.${ids.workspace},generation.eq.7),and(workspace_id.eq.${ids.otherWorkspace},generation.eq.3)`] },
    ]));
  });

  it("filters direct-ID reads before loading turns and checks the current workspace generation", async () => {
    const fake = queryClient({ workspaces: [workspaceRow], ai_chat_sessions: [sessionRow], ai_chat_turns: [] });
    const result = await readAiSession(fake.client, ids.session, personal);
    expect(result.session.id).toBe(ids.session);
    expect(fake.calls).toEqual(expect.arrayContaining([
      { table: "ai_chat_sessions", method: "eq", args: ["id", ids.session] },
      { table: "ai_chat_sessions", method: "eq", args: ["scope_key", personal.key] },
      { table: "ai_chat_sessions", method: "eq", args: ["workspace_id", ids.workspace] },
      { table: "ai_chat_sessions", method: "eq", args: ["generation", 7] },
      { table: "ai_chat_sessions", method: "eq", args: ["surface", "CHATBOT"] },
      { table: "ai_chat_turns", method: "eq", args: ["session_id", ids.session] },
    ]));
    await expect(readAiSession(fake.client, "bad-id", personal)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    ["another workspace", { ...personal, workspaceId: ids.otherWorkspace }],
    ["another role", { ...personal, key: `${ids.profile}:ADMIN:CHATBOT:formal` }],
    ["another surface", { ...personal, key: `${ids.profile}:MANAGER:WORKSPACE:formal`, surface: "WORKSPACE" as const }],
    ["another generation", { ...personal, generation: 8 }],
  ])("does not return direct or listed rows for %s", async (_label, foreignScope) => {
    const listFake = queryClient({ workspaces: [workspaceRow], ai_chat_sessions: [sessionRow] });
    if (foreignScope.workspaceId === ids.otherWorkspace) {
      await expect(readAiSessions(listFake.client, foreignScope, ids.otherWorkspace)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } else {
      const listed = await readAiSessions(listFake.client, foreignScope, ids.workspace);
      expect(listed.sessions).toEqual([]);
    }
    const directFake = queryClient({ workspaces: [workspaceRow], ai_chat_sessions: [sessionRow], ai_chat_turns: [] });
    await expect(readAiSession(directFake.client, ids.session, foreignScope)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(directFake.from).toHaveBeenCalledTimes(1);
  });

  it("hides stale-generation, inactive, and non-business workspace sessions", async () => {
    for (const workspace of [
      { ...workspaceRow, generation: 8 }, { ...workspaceRow, active: false }, { ...workspaceRow, kind: "OTHER" },
    ]) {
      const fake = queryClient({ workspaces: [workspace], ai_chat_sessions: [sessionRow], ai_chat_turns: [] });
      await expect(readAiSession(fake.client, ids.session, personal)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fake.from).toHaveBeenCalledTimes(2);
    }
  });
});
