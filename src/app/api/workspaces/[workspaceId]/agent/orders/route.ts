import { NextResponse } from "next/server";
import { z } from "zod";

import { ProviderAllowanceError, runWorkspaceOrdersAgent, WorkspaceOrdersAgentError } from "@/lib/ai/runtime/workspace-orders-agent";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { buildWorkspaceAIRecord } from "@/lib/observability/workspace-ai-record";
import { persistWorkspaceAIRecord } from "@/lib/observability/workspace-ai-store";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const bodySchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  focusOrderId: z.string().uuid().optional(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { workspaceId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const traceId = crypto.randomUUID();
  const startedAt = performance.now();
  let scope: { actor: ActorContext; guestVisitId: string | null; demoGeneration: number | null } | null = null;
  async function observe(status: "SUCCEEDED" | "CONTROLLED" | "FAILED",
    errorCode: Parameters<typeof buildWorkspaceAIRecord>[0]["errorCode"],
    providerSteps?: number, usage?: { inputTokens?: number; outputTokens?: number }) {
    if (!scope) return;
    const { actor, guestVisitId, demoGeneration } = scope;
    try {
      await persistWorkspaceAIRecord(buildWorkspaceAIRecord({
        task: "WORKSPACE_ORDERS", traceId, actor, workspaceId, guestVisitId, demoGeneration, status, errorCode,
        durationMs: performance.now() - startedAt, providerSteps,
        inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
      }), actor.profileId);
    } catch { /* Observability must not change the request result. */ }
  }
  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { actor, client: supabase, guestVisit } = workspaceContext;
    if (actor.membership?.workspaceId !== workspaceId
        || (actor.isAnonymous && !guestVisit)
        || !hasActorPermission(actor, "ai:use")
        || !hasActorPermission(actor, "order:view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    scope = { actor, guestVisitId: guestVisit?.id ?? null,
      demoGeneration: guestVisit?.demoGeneration ?? null };
    if (guestVisit) {
      // Give an exhausted Guest a useful response even if provider resolution
      // fails. The atomic reservation below still guards every outbound step.
      const budget = await readGuestAiBudget(guestVisit);
      if (!budget) throw new ProviderAllowanceError("UNAVAILABLE");
      if (budget.remaining === 0) throw new ProviderAllowanceError("EXHAUSTED", budget.resetAt);
    }
    const result = await runWorkspaceOrdersAgent(
      actor, supabase, { workspaceId, question: parsed.data.question, focusOrderId: parsed.data.focusOrderId },
      {
        abortSignal: request.signal,
        beforeProviderCall: guestVisit ? async () => {
          const reservation = await reserveGuestAiCall(guestVisit);
          if (!reservation) throw new ProviderAllowanceError("UNAVAILABLE");
          if (!reservation.allowed) throw new ProviderAllowanceError("EXHAUSTED", reservation.resetAt);
        } : undefined,
      },
    );
    await observe("SUCCEEDED", null, result.providerSteps, result.usage);
    // Only server-validated scoped tool evidence and a deterministic summary
    // reach the browser; raw provider prose is discarded.
    return NextResponse.json({ answer: result.answer, orders: result.orders,
      activity: result.activity, traceId },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ProviderAllowanceError) {
      await observe(error.code === "EXHAUSTED" ? "CONTROLLED" : "FAILED",
        error.code === "EXHAUSTED" ? "GUEST_AI_EXHAUSTED" : "GUEST_AI_UNAVAILABLE");
      return NextResponse.json({
        error: error.code === "EXHAUSTED"
          ? "Today's Guest AI allowance is used up. Please return after the Malaysia-time reset."
          : "Guest AI is temporarily unavailable. Manual Demo actions still work.",
        resetAt: error.resetAt ?? null,
        traceId,
      }, { status: error.code === "EXHAUSTED" ? 429 : 503 });
    }
    if (error instanceof WorkspaceOrderAccessError) {
      await observe("FAILED", "ORDER_ACCESS_DENIED");
      return NextResponse.json({ error: "Forbidden", traceId }, { status: 403 });
    }
    if (error instanceof WorkspaceOrdersAgentError) {
      await observe("FAILED", "WORKSPACE_AGENT_UNAVAILABLE");
      return NextResponse.json({ error: "AI Assist unavailable; use the order list", traceId }, { status: 503 });
    }
    await observe("FAILED", "WORKSPACE_AGENT_ERROR");
    return NextResponse.json({ error: "AI Assist unavailable; use the order list", traceId }, { status: 500 });
  }
}
