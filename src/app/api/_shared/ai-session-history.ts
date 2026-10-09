import { NextResponse } from "next/server";
import { z } from "zod";
import { aiSessionSurfaceSchema } from "@/domain/ai-sessions/contracts";
import { getWorkspaceRequestContext, refreshWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { createGuestServiceClient } from "@/lib/auth/guest-session";
import { createPlatformDataContext, PlatformPermissionDeniedError } from "@/lib/supabase/platform-server";
import { readWorkspaceGeneration } from "@/lib/services/workspaces/generation";
import { AiSessionError, canInspectAiSessions, sessionScope, readAiSession, readAiSessions } from "@/lib/services/ai-sessions/service";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const idSchema = z.string().uuid();
export async function aiHistoryResponse(request: Request, options: { workspaceId?: string; sessionId?: string; owner?: boolean }) {
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const workspaceFilter = options.workspaceId ?? url.searchParams.get("workspaceId") ?? undefined;
    if (cursor !== undefined && !idSchema.safeParse(cursor).success || workspaceFilter !== undefined && !idSchema.safeParse(workspaceFilter).success) throw new AiSessionError("NOT_FOUND");
    if (options.owner) {
      const { actor, supabase } = await createPlatformDataContext("diagnostics:view");
      if (!canInspectAiSessions(actor)) throw new AiSessionError("FORBIDDEN");
      const result = options.sessionId ? await readAiSession(supabase, options.sessionId, null)
        : await readAiSessions(supabase, null, workspaceFilter, cursor);
      const fresh = await getServerActorContext();
      if (!fresh || !canInspectAiSessions(fresh) || fresh.profileId !== actor.profileId || fresh.sessionId !== actor.sessionId) throw new AiSessionError("FORBIDDEN");
      return NextResponse.json(result, { headers: HEADERS });
    }
    const surface = aiSessionSurfaceSchema.safeParse(url.searchParams.get("surface"));
    if (!options.workspaceId || !surface.success) throw new AiSessionError("FORBIDDEN");
    const scope = await getWorkspaceRequestContext(options.workspaceId);
    if (!scope) throw new AiSessionError("FORBIDDEN");
    const key = sessionScope(scope, surface.data);
    const generation = await readWorkspaceGeneration(scope.actor, scope.client, options.workspaceId);
    if (scope.guestVisit && scope.guestVisit.demoGeneration !== generation) throw new AiSessionError("FORBIDDEN");
    const client = createGuestServiceClient();
    if (!client) throw new AiSessionError("UNAVAILABLE");
    const personal = { key, workspaceId: options.workspaceId, surface: surface.data, generation };
    const result = options.sessionId ? await readAiSession(client, options.sessionId, personal) : await readAiSessions(client, personal, options.workspaceId, cursor);
    // Do not publish history after a session, role, visit or generation change during the read.
    const fresh = await refreshWorkspaceRequestContext(scope, options.workspaceId);
    if (!fresh || sessionScope(fresh, surface.data) !== key || fresh.actor.sessionId !== scope.actor.sessionId ||
      fresh.actor.staff?.authRevision !== scope.actor.staff?.authRevision ||
      await readWorkspaceGeneration(fresh.actor, fresh.client, options.workspaceId) !== generation) throw new AiSessionError("FORBIDDEN");
    return NextResponse.json(result, { headers: HEADERS });
  } catch (cause) {
    const code = cause instanceof PlatformPermissionDeniedError ? "FORBIDDEN" : cause instanceof AiSessionError ? cause.code : "UNAVAILABLE";
    return NextResponse.json({ error: code === "FORBIDDEN" ? "Forbidden" : code === "NOT_FOUND" ? "Conversation not found" : "Conversation history is unavailable. Current AI and manual operations remain available." },
      { status: code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 503, headers: HEADERS });
  }
}
