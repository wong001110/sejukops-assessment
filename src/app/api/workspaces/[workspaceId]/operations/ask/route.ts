import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { canUseOperationsAi } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext, type WorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { resolveActorFromAuthenticatedClient } from "@/lib/auth/server-actor";
import { createGuestServiceClient, GUEST_COOKIE_NAME, resolveGuestVisit } from "@/lib/auth/guest-session";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { readWorkspaceGeneration } from "@/lib/services/workspaces/generation";
import { runOperationsAsk, OperationsAskError, withOperationsAbort, OPERATIONS_ASK_FAILURE_REASONS } from "@/lib/ai/runtime/operations-ask";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { ProviderAllowanceError } from "@/lib/ai/runtime/workspace-orders-agent";
import { runWithAIProviderObservation } from "@/lib/observability/ai-provider-observation-server";
import { buildWorkspaceAIRecord } from "@/lib/observability/workspace-ai-record";
import { persistWorkspaceAIRecord } from "@/lib/observability/workspace-ai-store";
import { safeProviderExchangeMetadata } from "@/lib/observability/safe-provider-exchange-metadata";
import { operationsAskFailureMessage, type OperationsAskFailureReason, type OperationsSdkErrorKind } from "@/lib/ai/runtime/operations-ask-diagnostics";

const HEADERS = { "Cache-Control": "private, no-store" };
const schema = z.object({ question: z.string().trim().min(1).max(120) }).strict();
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: HEADERS });
  const { workspaceId } = await context.params;
  let raw: unknown; try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: HEADERS }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: HEADERS });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  let scope: WorkspaceRequestContext | null = null, steps = 0;
  let exchangeMetadata: ReturnType<typeof safeProviderExchangeMetadata> | undefined;
  let failureReason: OperationsAskFailureReason | undefined;
  let sdkErrorKind: OperationsSdkErrorKind | undefined;
  const traceId = crypto.randomUUID(), start = performance.now();
  async function observe(status: "SUCCEEDED" | "CONTROLLED" | "FAILED", errorCode: Parameters<typeof buildWorkspaceAIRecord>[0]["errorCode"], usage?: { inputTokens?: number; outputTokens?: number }) {
    if (!scope) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([persistWorkspaceAIRecord(buildWorkspaceAIRecord({ task: "OPERATIONS_QUERY", traceId, actor: scope.actor, workspaceId,
      guestVisitId: scope.guestVisit?.id ?? null, demoGeneration: scope.guestVisit?.demoGeneration ?? null,
      status, errorCode, durationMs: performance.now() - start, providerSteps: steps, ...usage,
      diagnostics: { ...exchangeMetadata?.diagnostics, operationsFailureReason: failureReason, sdkErrorKind } }), scope.actor.profileId),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 1_000); })]); }
    catch { /* Safe observation cannot change the result. */ }
    finally { if (timer) clearTimeout(timer); }
  }
  try {
    signal.throwIfAborted();
    scope = await withOperationsAbort(signal, () => getWorkspaceRequestContext(workspaceId));
    if (!scope || scope.actor.membership?.workspaceId !== workspaceId || !canUseOperationsAi(scope.actor) || (scope.actor.isAnonymous && !scope.guestVisit)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: HEADERS });
    }
    const resolved = scope;
    const generation = await withOperationsAbort(signal, () => readWorkspaceGeneration(resolved.actor, resolved.client, workspaceId));
    const token = resolved.guestVisit ? (await withOperationsAbort(signal, cookies)).get(GUEST_COOKIE_NAME)?.value : undefined;
    async function revalidateScope() {
      signal.throwIfAborted();
      const prior = resolved.actor;
      const service = resolved.guestVisit ? createGuestServiceClient() : null;
      // These are independent reads from the already bound session/visit.
      // Settle every check, then validate the complete fresh scope before any tool/provider call.
      const [actorRead, visitRead, generationRead] = await Promise.allSettled([
        withOperationsAbort(signal, () => resolveActorFromAuthenticatedClient(resolved.client, workspaceId)),
        resolved.guestVisit && service ? withOperationsAbort(signal, () => resolveGuestVisit(service, token)) : Promise.resolve(null),
        withOperationsAbort(signal, () => readWorkspaceGeneration(prior, resolved.client, workspaceId)),
      ]);
      signal.throwIfAborted();
      if (actorRead.status === "rejected") throw actorRead.reason;
      if (visitRead.status === "rejected") throw visitRead.reason;
      if (generationRead.status === "rejected") throw generationRead.reason;
      const fresh = actorRead.value, visit = visitRead.value, freshGeneration = generationRead.value;
      if (!fresh || !canUseOperationsAi(fresh) || fresh.authUserId !== prior.authUserId || fresh.profileId !== prior.profileId ||
          fresh.isAnonymous !== prior.isAnonymous || fresh.platformRole !== prior.platformRole || fresh.membership?.workspaceId !== workspaceId ||
          fresh.membership?.kind !== prior.membership?.kind || fresh.membership?.role !== prior.membership?.role ||
          fresh.sessionId !== prior.sessionId || fresh.staff?.authRevision !== prior.staff?.authRevision) throw new OperationsAskError("FORBIDDEN");
      if (resolved.guestVisit) {
        if (!visit || visit.id !== resolved.guestVisit.id || visit.workspaceId !== workspaceId || visit.persona !== resolved.guestVisit.persona ||
            visit.demoGeneration !== generation || visit.demoGeneration !== resolved.guestVisit.demoGeneration) throw new OperationsAskError("STALE");
      }
      if (freshGeneration !== generation) throw new OperationsAskError("STALE");
      signal.throwIfAborted();
      return freshGeneration;
    }
    await revalidateScope();
    if (resolved.guestVisit) {
      const budget = await withOperationsAbort(signal, () => readGuestAiBudget(resolved.guestVisit!));
      if (!budget) throw new ProviderAllowanceError("UNAVAILABLE");
      if (!budget.remaining) throw new ProviderAllowanceError("EXHAUSTED", budget.resetAt);
    }
    const observed = await withOperationsAbort(signal, () => runWithAIProviderObservation(request, "OPERATIONS_QUERY", () => runOperationsAsk(resolved.actor, resolved.client,
      { workspaceId, question: parsed.data.question }, {
        abortSignal: signal, revalidateScope,
        beforeProviderCall: async () => {
          signal.throwIfAborted(); await revalidateScope();
          if (resolved.guestVisit) {
            const reservation = await withOperationsAbort(signal, () => reserveGuestAiCall(resolved.guestVisit!));
            if (!reservation) throw new ProviderAllowanceError("UNAVAILABLE");
            if (!reservation.allowed) throw new ProviderAllowanceError("EXHAUSTED", reservation.resetAt);
          }
          signal.throwIfAborted();
        },
        onProviderStepStart: () => { steps += 1; },
      })));
    exchangeMetadata = safeProviderExchangeMetadata(observed.exchanges);
    if (!observed.ok) throw observed.error;
    await revalidateScope();
    const { providerSteps, usage, diagnostics, ...result } = observed.value;
    if (diagnostics) { failureReason = diagnostics.failureReason; sdkErrorKind = diagnostics.sdkErrorKind; }
    steps = providerSteps;
    await withOperationsAbort(signal, () => observe(result.status === "EVIDENCE_FOUND" ? "SUCCEEDED" : "CONTROLLED", null, usage));
    await revalidateScope();
    return NextResponse.json({ ...result, traceId }, { headers: HEADERS });
  } catch (cause) {
    const allowance = cause instanceof ProviderAllowanceError, denied = cause instanceof OperationsAskError && cause.code === "FORBIDDEN";
    const stale = cause instanceof OperationsAskError && cause.code === "STALE";
    const cancelled = signal.aborted || (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError"));
    const candidateReason = cancelled ? "CANCELLED_TIMEOUT" : allowance ? cause.code === "EXHAUSTED" ? "ALLOWANCE_EXHAUSTED" : "ALLOWANCE_UNAVAILABLE"
      : cause instanceof OperationsAskError ? cause.reason : "UNEXPECTED_FAILURE";
    const reason = OPERATIONS_ASK_FAILURE_REASONS.find((value) => value === candidateReason) ?? "UNEXPECTED_FAILURE";
    failureReason = reason;
    sdkErrorKind = cause instanceof OperationsAskError ? cause.sdkErrorKind : undefined;
    // Only a fixed allowlisted reason reaches the local technical log. Never include the error or model/source text.
    console.warn("OPERATIONS_ASK_FAILURE", reason);
    if (!signal.aborted) {
      try { await withOperationsAbort(signal, () => observe(allowance || stale ? "CONTROLLED" : "FAILED", allowance ? cause.code === "EXHAUSTED" ? "GUEST_AI_EXHAUSTED" : "GUEST_AI_UNAVAILABLE"
        : denied ? "ORDER_ACCESS_DENIED" : "WORKSPACE_AGENT_UNAVAILABLE")); } catch { /* Cancelled diagnostics cannot delay the response. */ }
    }
    return NextResponse.json({ error: denied ? "Forbidden" : stale ? "Your access or sources changed. Refresh and ask again."
      : allowance ? cause.code === "EXHAUSTED" ? "Today's Guest AI allowance is used up. Manual search still works." : "Guest AI is temporarily unavailable."
      : signal.aborted ? "Request cancelled or timed out. You can retry or search manually." : operationsAskFailureMessage(reason),
      ...(allowance ? { resetAt: cause.resetAt ?? null } : {}), traceId },
    { status: denied ? 403 : stale ? 409 : allowance && cause.code === "EXHAUSTED" ? 429 : 503, headers: HEADERS });
  }
}
