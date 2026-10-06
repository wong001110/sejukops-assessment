import { NextResponse } from "next/server";
import { z } from "zod";

import { ProviderAllowanceError } from "@/lib/ai/runtime/workspace-orders-agent";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { runWorkspaceKnowledgeAgent, WorkspaceKnowledgeAgentAccessError, WorkspaceKnowledgeAgentError } from "@/lib/ai/runtime/workspace-knowledge-agent";
import { canUseKnowledgeAi, type ActorContext } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { buildWorkspaceAIRecord } from "@/lib/observability/workspace-ai-record";
import { runWithAIProviderObservation } from "@/lib/observability/ai-provider-observation-server";
import { safeProviderExchangeMetadata } from "@/lib/observability/safe-provider-exchange-metadata";
import { persistWorkspaceAIRecord } from "@/lib/observability/workspace-ai-store";
import { WorkspaceKnowledgeError } from "@/lib/services/workspace-knowledge/service";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const bodySchema = z.object({ question: z.string().trim().min(1).max(120) }).strict();

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { workspaceId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const traceId = crypto.randomUUID();
  const startedAt = performance.now();
  let providerStepsStarted = 0;
  let exchangeMetadata: ReturnType<typeof safeProviderExchangeMetadata> | undefined;
  let scope: { actor: ActorContext; guestVisitId: string | null; demoGeneration: number | null } | null = null;
  async function observe(status: "SUCCEEDED" | "CONTROLLED" | "FAILED",
    errorCode: Parameters<typeof buildWorkspaceAIRecord>[0]["errorCode"],
    providerSteps?: number, usage?: { inputTokens?: number; outputTokens?: number },
    diagnostics?: Parameters<typeof buildWorkspaceAIRecord>[0]["diagnostics"]) {
    if (!scope) return;
    const { actor, guestVisitId, demoGeneration } = scope;
    try {
      await persistWorkspaceAIRecord(buildWorkspaceAIRecord({
        task: "WORKSPACE_KNOWLEDGE", traceId, actor, workspaceId, guestVisitId,
        demoGeneration, status, errorCode, durationMs: performance.now() - startedAt,
        providerSteps, inputTokens: usage?.inputTokens ?? exchangeMetadata?.inputTokens,
        outputTokens: usage?.outputTokens ?? exchangeMetadata?.outputTokens,
        diagnostics: exchangeMetadata ? { ...exchangeMetadata.diagnostics, ...diagnostics,
          reasoningTokens: diagnostics?.reasoningTokens ?? exchangeMetadata.diagnostics.reasoningTokens } : diagnostics,
      }), actor.profileId);
    } catch { /* Diagnostics must not change the knowledge result. */ }
  }

  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { actor, client: supabase, guestVisit } = workspaceContext;
    if (actor.membership?.workspaceId !== workspaceId || (actor.isAnonymous && !guestVisit)
        || !canUseKnowledgeAi(actor)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    scope = { actor, guestVisitId: guestVisit?.id ?? null,
      demoGeneration: guestVisit?.demoGeneration ?? null };
    if (guestVisit) {
      const budget = await readGuestAiBudget(guestVisit);
      if (!budget) throw new ProviderAllowanceError("UNAVAILABLE");
      if (budget.remaining === 0) throw new ProviderAllowanceError("EXHAUSTED", budget.resetAt);
    }
    const observed = await runWithAIProviderObservation(request, "WORKSPACE_KNOWLEDGE", () => runWorkspaceKnowledgeAgent(
      actor, supabase, { workspaceId, question: parsed.data.question },
      {
        abortSignal: request.signal,
        onProviderStepStart: () => { providerStepsStarted += 1; },
        beforeProviderCall: guestVisit ? async () => {
          const reservation = await reserveGuestAiCall(guestVisit);
          if (!reservation) throw new ProviderAllowanceError("UNAVAILABLE");
          if (!reservation.allowed) throw new ProviderAllowanceError("EXHAUSTED", reservation.resetAt);
        } : undefined,
      },
    ));
    exchangeMetadata = safeProviderExchangeMetadata(observed.exchanges);
    if (!observed.ok) throw observed.error;
    const result = observed.value;
    await observe(result.status === "EXCERPTS_FOUND" ? "SUCCEEDED" : "CONTROLLED",
      null, result.providerSteps, result.usage, result.diagnostics);
    return NextResponse.json({ status: result.status, answer: result.answer,
      excerpts: result.excerpts, activity: result.activity, traceId },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ProviderAllowanceError) {
      await observe(error.code === "EXHAUSTED" ? "CONTROLLED" : "FAILED",
        error.code === "EXHAUSTED" ? "GUEST_AI_EXHAUSTED" : "GUEST_AI_UNAVAILABLE",
        providerStepsStarted);
      return NextResponse.json({ error: error.code === "EXHAUSTED"
        ? "Today's Guest AI allowance is used up. Please return after the Malaysia-time reset."
        : "Guest AI is temporarily unavailable. Manual knowledge search still works.",
        resetAt: error.resetAt ?? null, traceId },
      { status: error.code === "EXHAUSTED" ? 429 : 503 });
    }
    if (error instanceof WorkspaceKnowledgeAgentAccessError ||
        (error instanceof WorkspaceKnowledgeError && error.code === "FORBIDDEN")) {
      await observe("FAILED", "KNOWLEDGE_ACCESS_DENIED", providerStepsStarted);
      return NextResponse.json({ error: "Forbidden", traceId }, { status: 403 });
    }
    if (error instanceof WorkspaceKnowledgeAgentError || error instanceof WorkspaceKnowledgeError) {
      await observe("FAILED", "KNOWLEDGE_AGENT_UNAVAILABLE", providerStepsStarted, undefined,
        error instanceof WorkspaceKnowledgeAgentError ? error.diagnostics : undefined);
      return NextResponse.json({ error: "Knowledge AI unavailable; search manually", traceId }, { status: 503 });
    }
    await observe("FAILED", "KNOWLEDGE_AGENT_ERROR", providerStepsStarted);
    return NextResponse.json({ error: "Knowledge AI unavailable; search manually", traceId }, { status: 500 });
  }
}
