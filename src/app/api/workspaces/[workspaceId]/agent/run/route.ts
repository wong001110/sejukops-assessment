import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { nativeAgentEventSchema, nativeAgentRequestSchema, type NativeAgentEvent } from "@/domain/agent-workspace/contracts";
import { runWorkspaceNativeAgent, withNativeAbort, WorkspaceNativeAgentError } from "@/lib/ai/runtime/workspace-native-agent";
import { ProviderAllowanceError } from "@/lib/ai/runtime/workspace-orders-agent";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { createGuestServiceClient, GUEST_COOKIE_NAME, resolveGuestVisit } from "@/lib/auth/guest-session";
import { resolveActorFromAuthenticatedClient } from "@/lib/auth/server-actor";
import { getWorkspaceRequestContext, type WorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { buildWorkspaceAIRecord } from "@/lib/observability/workspace-ai-record";
import { persistWorkspaceAIRecord } from "@/lib/observability/workspace-ai-store";
import { readWorkspaceGeneration } from "@/lib/services/workspaces/generation";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const MAX_BODY_BYTES = 24 * 1024;
const HEADERS = { "Cache-Control": "private, no-store" };

async function boundedBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error("body-size");
  if (!request.body) throw new Error("body-missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("body-size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function allowed(scope: WorkspaceRequestContext, workspaceId: string) {
  return scope.actor.membership?.workspaceId === workspaceId && !scope.actor.preview &&
    hasActorPermission(scope.actor, "ai:use") && hasActorPermission(scope.actor, "order:view") &&
    !(scope.actor.isAnonymous && !scope.guestVisit);
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: HEADERS });
  const deadlineSignal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  const { workspaceId } = await context.params;
  let input;
  try { input = nativeAgentRequestSchema.parse(await withNativeAbort(deadlineSignal, () => boundedBody(request))); }
  catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: HEADERS }); }
  let scope: WorkspaceRequestContext;
  let generation: number;
  let token: string | undefined;
  try {
    const resolved = await withNativeAbort(deadlineSignal, () => getWorkspaceRequestContext(workspaceId));
    if (!resolved || !allowed(resolved, workspaceId)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: HEADERS });
    scope = resolved;
    generation = await withNativeAbort(deadlineSignal, () => readWorkspaceGeneration(scope.actor, scope.client, workspaceId));
    if (scope.guestVisit) {
      token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
      if (!token || generation !== scope.guestVisit.demoGeneration) throw new WorkspaceNativeAgentError("STALE");
      const budget = await withNativeAbort(deadlineSignal, () => readGuestAiBudget(scope.guestVisit!));
      if (!budget) throw new ProviderAllowanceError("UNAVAILABLE");
      if (budget.remaining === 0) throw new ProviderAllowanceError("EXHAUSTED", budget.resetAt);
    }
  } catch (error) {
    if (error instanceof ProviderAllowanceError) return NextResponse.json({ error: error.code === "EXHAUSTED"
      ? "Today's Guest AI allowance is used up. Manual Demo actions still work." : "Guest AI is temporarily unavailable.",
      resetAt: error.resetAt ?? null }, { status: error.code === "EXHAUSTED" ? 429 : 503, headers: HEADERS });
    return NextResponse.json({ error: "Workspace conversation unavailable" }, { status: 503, headers: HEADERS });
  }
  const runId = crypto.randomUUID();
  const startedAt = performance.now();
  let providerSteps = 0;
  const abort = new AbortController();
  const streamSignal = AbortSignal.any([abort.signal, deadlineSignal]);
  const disconnect = () => abort.abort(new DOMException("Request cancelled", "AbortError"));
  if (request.signal.aborted) disconnect();
  else request.signal.addEventListener("abort", disconnect, { once: true });
  async function revalidateScope() {
    streamSignal.throwIfAborted();
    const actor = await resolveActorFromAuthenticatedClient(scope.client, workspaceId);
    if (!actor || actor.preview || actor.authUserId !== scope.actor.authUserId || actor.profileId !== scope.actor.profileId ||
        actor.platformRole !== scope.actor.platformRole || actor.membership?.role !== scope.actor.membership?.role ||
        actor.membership?.kind !== scope.actor.membership?.kind || actor.membership?.workspaceId !== workspaceId ||
        actor.sessionId !== scope.actor.sessionId || actor.staff?.authRevision !== scope.actor.staff?.authRevision ||
        !hasActorPermission(actor, "ai:use") || !hasActorPermission(actor, "order:view")) throw new WorkspaceNativeAgentError("FORBIDDEN");
    if (scope.guestVisit) {
      const service = createGuestServiceClient();
      const freshVisit = service && await resolveGuestVisit(service, token);
      if (!freshVisit || freshVisit.id !== scope.guestVisit.id || freshVisit.workspaceId !== workspaceId ||
          freshVisit.demoGeneration !== generation || freshVisit.persona !== scope.guestVisit.persona) throw new WorkspaceNativeAgentError("STALE");
    }
    if (await readWorkspaceGeneration(actor, scope.client, workspaceId) !== generation) throw new WorkspaceNativeAgentError("STALE");
    streamSignal.throwIfAborted();
  }
  async function observe(status: "SUCCEEDED" | "CONTROLLED" | "FAILED", errorCode: Parameters<typeof buildWorkspaceAIRecord>[0]["errorCode"],
    usage?: { inputTokens?: number; outputTokens?: number }) {
    try { await persistWorkspaceAIRecord(buildWorkspaceAIRecord({ task: "WORKSPACE_ORDERS", nativeConversation: true,
      traceId: runId, actor: scope.actor, workspaceId, guestVisitId: scope.guestVisit?.id ?? null,
      demoGeneration: scope.guestVisit?.demoGeneration ?? null, status, errorCode,
      durationMs: performance.now() - startedAt, providerSteps, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    }), scope.actor.profileId); } catch { /* Metadata persistence cannot change the result. */ }
  }
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        request.signal.removeEventListener("abort", disconnect);
        if (!closed) { closed = true; controller.close(); }
      };
      const send = (event: NativeAgentEvent) => {
        if (closed || abort.signal.aborted) return;
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(nativeAgentEventSchema.parse(event))}\n`));
      };
      send({ type: "started", runId });
      void (async () => {
        try {
          await withNativeAbort(streamSignal, revalidateScope);
          const result = await withNativeAbort(streamSignal, () => runWorkspaceNativeAgent(scope.actor, scope.client, workspaceId, input, {
            runId, isGuest: Boolean(scope.guestVisit), abortSignal: streamSignal,
            revalidateScope: () => withNativeAbort(streamSignal, revalidateScope),
            onProviderStepStart: (step) => { providerSteps = step; },
            onActivity: (activity) => send({ type: "activity", activity }),
            beforeProviderCall: scope.guestVisit ? async () => {
              const reservation = await reserveGuestAiCall(scope.guestVisit!);
              if (!reservation) throw new ProviderAllowanceError("UNAVAILABLE");
              if (!reservation.allowed) throw new ProviderAllowanceError("EXHAUSTED", reservation.resetAt);
            } : undefined,
          }));
          // Check fresh authority/generation once more immediately before public output.
          await withNativeAbort(streamSignal, revalidateScope);
          send({ type: "workspace", workspace: result.workspace });
          close();
          await observe(result.workspace.status === "SOURCE_ONLY" ? "CONTROLLED" : "SUCCEEDED", null, result.usage);
        } catch (error) {
          if (abort.signal.aborted) { close(); await observe("CONTROLLED", "WORKSPACE_AGENT_ERROR"); }
          else if (error instanceof ProviderAllowanceError) {
            send({ type: "error", code: error.code === "EXHAUSTED" ? "GUEST_AI_EXHAUSTED" : "GUEST_AI_UNAVAILABLE",
              message: error.code === "EXHAUSTED" ? "Today's Guest AI allowance is used up. Manual Demo actions still work."
                : "Guest AI is temporarily unavailable. Manual Demo actions still work.", resetAt: error.resetAt ?? null });
            close();
            await observe(error.code === "EXHAUSTED" ? "CONTROLLED" : "FAILED", error.code === "EXHAUSTED" ? "GUEST_AI_EXHAUSTED" : "GUEST_AI_UNAVAILABLE");
          } else {
            const code = error instanceof WorkspaceNativeAgentError ? error.code
              : error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "UNAVAILABLE";
            send({ type: "error", code, message: code === "TIMEOUT" ? "The assistant reached its time limit. Try a smaller request or continue manually."
              : code === "STALE" ? "Workspace data changed. Start a fresh request."
              : code === "FORBIDDEN" ? "Your workspace access changed. Refresh to continue."
                : "The assistant could not complete this request. Continue from Orders or Knowledge." });
            close();
            await observe(code === "TIMEOUT" ? "CONTROLLED" : "FAILED", code === "FORBIDDEN" ? "ORDER_ACCESS_DENIED" : "WORKSPACE_AGENT_UNAVAILABLE");
          }
        } finally {
          close();
        }
      })();
    },
    cancel() { closed = true; disconnect(); request.signal.removeEventListener("abort", disconnect); },
  });
  return new Response(stream, { headers: { ...HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}
