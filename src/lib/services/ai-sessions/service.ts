import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { aiSessionDetailResponseSchema, aiSessionListResponseSchema, aiSessionSummarySchema, aiSessionTurnSchema,
  type AiSessionSurface, type AiSessionTurn } from "@/domain/ai-sessions/contracts";
import { hasActorPermission, canUseOperationsAi } from "@/lib/auth/actor-policy";
import type { WorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { createGuestServiceClient } from "@/lib/auth/guest-session";

export class AiSessionError extends Error {
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND" | "UNAVAILABLE" | "BUSY" | "LIMIT") { super(`Conversation ${code.toLowerCase()}`); }
}
const UUID = z.string().uuid();
export function sessionScope(scope: WorkspaceRequestContext, surface: AiSessionSurface) {
  const actor = scope.actor;
  if (!actor.membership || actor.preview || actor.businessReady === false ||
    (actor.isAnonymous && !scope.guestVisit) ||
    !(surface === "CHATBOT" ? canUseOperationsAi(actor) : hasActorPermission(actor, "ai:use") && hasActorPermission(actor, "order:view"))) {
    throw new AiSessionError("FORBIDDEN");
  }
  if (scope.guestVisit && (actor.membership.kind !== "DEMO" || scope.guestVisit.workspaceId !== actor.membership.workspaceId || scope.guestVisit.persona !== actor.membership.role)) throw new AiSessionError("FORBIDDEN");
  return `${actor.profileId}:${actor.membership.role}:${surface}:${scope.guestVisit?.id ?? "formal"}`;
}
export function canInspectAiSessions(actor: ActorContext): boolean {
  return !actor.isAnonymous && !actor.preview && actor.businessReady !== false && actor.platformRole === "SUPER_ADMIN";
}
const sessionFields = "id,workspace_id,workspace_kind,generation,title,surface,role,created_at,updated_at,turn_count";
function summary(row: Record<string, unknown>) {
  return aiSessionSummarySchema.parse({ id: row.id, workspaceId: row.workspace_id, workspaceKind: row.workspace_kind,
    title: row.title, surface: row.surface, role: row.role, createdAt: row.created_at, updatedAt: row.updated_at, turnCount: row.turn_count });
}
function turn(row: Record<string, unknown>): AiSessionTurn {
  const unsettled = row.status === "RUNNING" && Date.now() - Date.parse(String(row.created_at)) > 65_000;
  return aiSessionTurnSchema.parse({ id: row.id, question: row.question, status: unsettled ? "INTERRUPTED" : row.status,
    answer: row.answer, createdAt: row.created_at, completedAt: row.completed_at,
    workspace: row.workspace_snapshot, activity: row.activity });
}
export type SessionJournal = { sessionId: string; turnId: string; client: SupabaseClient; generation: number; scopeKey: string };

/** Optional, server-authored recording. Existing clients without a header keep their old behavior. */
export async function beginAiSessionTurn(scope: WorkspaceRequestContext, surface: AiSessionSurface, generation: number,
  sessionId: string | undefined, turnId: string, question: string): Promise<SessionJournal | null> {
  if (!sessionId) return null;
  if (!UUID.safeParse(sessionId).success || !UUID.safeParse(turnId).success || question.length > 1000 || !question.trim()) throw new AiSessionError("FORBIDDEN");
  const key = sessionScope(scope, surface);
  const client = createGuestServiceClient();
  if (!client) return null;
  const member = scope.actor.membership!;
  try {
    const { data, error } = await client.rpc("ai_session_turn_begin", {
      p_session_id: sessionId, p_turn_id: turnId, p_workspace_id: member.workspaceId, p_profile_id: scope.actor.profileId,
      p_scope_key: key, p_role: member.role, p_surface: surface, p_generation: generation, p_question: question,
    }).abortSignal(AbortSignal.timeout(2000));
    if (error) return null;
    if (data === "FORBIDDEN") throw new AiSessionError("FORBIDDEN");
    if (data === "BUSY") throw new AiSessionError("BUSY");
    if (data === "LIMIT") throw new AiSessionError("LIMIT");
    return data === "RECORDED" ? { sessionId, turnId, client, generation, scopeKey: key } : null;
  } catch (cause) { if (cause instanceof AiSessionError) throw cause; return null; }
}
/** No browser may submit assistant messages or terminal states. The caller supplies only verified public output. */
export async function finishAiSessionTurn(journal: SessionJournal | null, result: Pick<AiSessionTurn, "answer" | "workspace" | "activity">,
  status: "COMPLETED" | "FAILED" | "INTERRUPTED"): Promise<boolean> {
  if (!journal) return false;
  const safe = aiSessionTurnSchema.pick({ answer: true, workspace: true, activity: true }).parse(result);
  try {
    const { data, error } = await journal.client.rpc("ai_session_turn_finish", { p_turn_id: journal.turnId,
      p_session_id: journal.sessionId, p_scope_key: journal.scopeKey, p_generation: journal.generation,
      p_status: status, p_answer: safe.answer, p_workspace_snapshot: safe.workspace, p_activity: safe.activity }).abortSignal(AbortSignal.timeout(2000));
    return !error && data === true;
  } catch { return false; }
}

type PersonalScope = { key: string; workspaceId: string; generation: number; surface: AiSessionSurface };
export async function readAiSessions(client: SupabaseClient, personal: PersonalScope | null, workspaceId?: string, cursor?: string) {
  const { data: rows, error: workspaceError } = await client.from("workspaces").select("id,kind,name,generation").eq("active", true)
    .in("kind", ["DEMO", "OWNER"]);
  if (workspaceError || !rows) throw new AiSessionError("UNAVAILABLE");
  const allowed = rows.filter((row) => !personal || row.id === personal.workspaceId);
  if (workspaceId && !allowed.some((row) => row.id === workspaceId)) throw new AiSessionError("NOT_FOUND");
  const selected = workspaceId ? allowed.filter((row) => row.id === workspaceId) : allowed;
  if (!selected.length) return aiSessionListResponseSchema.parse({ sessions: [], nextCursor: null, workspaces: [] });
  // Fixed generation predicates are composed only from DB-validated UUIDs and integers, never browser expressions.
  for (const row of selected) if (!UUID.safeParse(row.id).success || !Number.isSafeInteger(row.generation)) throw new AiSessionError("UNAVAILABLE");
  const generations = selected.map((row) => `and(workspace_id.eq.${row.id},generation.eq.${row.generation})`).join(",");
  function scopedQuery(predicate = generations) {
    let query = client.from("ai_chat_sessions").select(sessionFields).in("workspace_id", selected.map((row) => row.id)).or(predicate);
    if (personal) query = query.eq("scope_key", personal.key).eq("generation", personal.generation).eq("surface", personal.surface);
    return query;
  }
  let predicate = generations;
  if (cursor) {
    if (!UUID.safeParse(cursor).success) throw new AiSessionError("NOT_FOUND");
    // Resolve the cursor through the same authorization filters. Creation time is immutable,
    // so continuing an older session cannot reorder pages or skip other conversations.
    const { data: anchor, error: cursorError } = await scopedQuery().eq("id", cursor).maybeSingle();
    if (cursorError) throw new AiSessionError("UNAVAILABLE");
    if (!anchor) throw new AiSessionError("NOT_FOUND");
    const time = z.string().datetime({ offset: true }).safeParse(anchor.created_at);
    if (!time.success) throw new AiSessionError("UNAVAILABLE");
    predicate = `and(or(${generations}),or(created_at.lt.${time.data},and(created_at.eq.${time.data},id.lt.${cursor})))`;
  }
  const { data, error } = await scopedQuery(predicate).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(31);
  if (error || !data) throw new AiSessionError("UNAVAILABLE");
  return aiSessionListResponseSchema.parse({ sessions: data.slice(0, 30).map(summary),
    nextCursor: data.length > 30 ? data[29].id : null,
    workspaces: allowed.map(({ id, kind, name }) => ({ id, kind, name })) });
}
export async function readAiSession(client: SupabaseClient, id: string, personal: PersonalScope | null) {
  if (!UUID.safeParse(id).success) throw new AiSessionError("NOT_FOUND");
  let query = client.from("ai_chat_sessions").select(sessionFields).eq("id", id);
  if (personal) query = query.eq("scope_key", personal.key).eq("workspace_id", personal.workspaceId).eq("generation", personal.generation).eq("surface", personal.surface);
  const { data: row, error } = await query.maybeSingle();
  if (error) throw new AiSessionError("UNAVAILABLE");
  if (!row) throw new AiSessionError("NOT_FOUND");
  const { data: workspace, error: workspaceError } = await client.from("workspaces").select("generation,kind,active").eq("id", row.workspace_id).maybeSingle();
  if (workspaceError) throw new AiSessionError("UNAVAILABLE");
  if (!workspace || !workspace.active || workspace.generation !== row.generation || !["DEMO", "OWNER"].includes(workspace.kind)) throw new AiSessionError("NOT_FOUND");
  const { data: turns, error: turnError } = await client.from("ai_chat_turns").select("id,question,status,answer,created_at,completed_at,workspace_snapshot,activity")
    .eq("session_id", row.id).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(50);
  if (turnError || !turns) throw new AiSessionError("UNAVAILABLE");
  return aiSessionDetailResponseSchema.parse({ session: summary(row), turns: turns.map(turn) });
}
