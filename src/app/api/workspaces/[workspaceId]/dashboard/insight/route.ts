import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";
import { dashboardPeriodSchema } from "@/domain/operations-dashboard/contracts";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { canUseKnowledgeAi } from "@/lib/auth/actor-policy";
import { runDashboardInsight, DashboardInsightAccessError, DashboardInsightStaleError } from "@/lib/ai/runtime/dashboard-insight";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { ProviderAllowanceError } from "@/lib/ai/runtime/workspace-orders-agent";
import { runWithAIProviderObservation } from "@/lib/observability/ai-provider-observation-server";
import { buildWorkspaceAIRecord } from "@/lib/observability/workspace-ai-record";
import { persistWorkspaceAIRecord } from "@/lib/observability/workspace-ai-store";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  const { workspaceId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers }); }
  const parsed = z.object({ period: dashboardPeriodSchema }).strict().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  const scope = await getWorkspaceRequestContext(workspaceId);
  if (!scope || scope.actor.membership?.workspaceId !== workspaceId || !canUseKnowledgeAi(scope.actor) || (scope.actor.isAnonymous && !scope.guestVisit)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  const { actor, client, guestVisit } = scope;
  let guestProof: { visitId: string; tokenHash: string } | undefined;
  if (guestVisit) {
    const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
    if (!isGuestToken(token)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    guestProof = { visitId: guestVisit.id, tokenHash: guestTokenHash(token) };
  }
  const traceId = crypto.randomUUID();
  const start = performance.now();
  let steps = 0;
  async function observe(status: "SUCCEEDED" | "CONTROLLED" | "FAILED", errorCode: Parameters<typeof buildWorkspaceAIRecord>[0]["errorCode"], usage?: { inputTokens?: number; outputTokens?: number }) {
    await persistWorkspaceAIRecord(buildWorkspaceAIRecord({ task: "OPERATIONAL_INSIGHT", traceId, actor, workspaceId,
      guestVisitId: guestVisit?.id ?? null, demoGeneration: guestVisit?.demoGeneration ?? null,
      status, errorCode, durationMs: performance.now() - start, providerSteps: steps, ...usage }), actor.profileId);
  }
  try {
    if (guestVisit) {
      const budget = await readGuestAiBudget(guestVisit);
      if (!budget) throw new ProviderAllowanceError("UNAVAILABLE");
      if (!budget.remaining) throw new ProviderAllowanceError("EXHAUSTED", budget.resetAt);
    }
    const observed = await runWithAIProviderObservation(request, "OPERATIONAL_INSIGHT", () => runDashboardInsight(actor, client,
      { workspaceId, period: parsed.data.period }, {
        guestProof,
        abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        beforeProviderCall: async () => {
          if (guestVisit) {
            const reservation = await reserveGuestAiCall(guestVisit);
            if (!reservation) throw new ProviderAllowanceError("UNAVAILABLE");
            if (!reservation.allowed) throw new ProviderAllowanceError("EXHAUSTED", reservation.resetAt);
          }
          steps += 1;
        },
      }));
    if (!observed.ok) throw observed.error;
    const { highlights, period, asOf, generation, usage } = observed.value;
    await observe("SUCCEEDED", null, usage);
    return NextResponse.json({ highlights, period, asOf, generation, traceId }, { headers });
  } catch (cause) {
    const allowance = cause instanceof ProviderAllowanceError;
    const stale = cause instanceof DashboardInsightStaleError;
    const denied = cause instanceof DashboardInsightAccessError;
    await observe(stale || allowance ? "CONTROLLED" : "FAILED", allowance ? cause.code === "EXHAUSTED" ? "GUEST_AI_EXHAUSTED" : "GUEST_AI_UNAVAILABLE" : "WORKSPACE_AGENT_UNAVAILABLE");
    return NextResponse.json({ error: stale ? "Dashboard data changed. Refresh and request a new insight."
      : allowance ? cause.code === "EXHAUSTED" ? "Today's Guest AI allowance is used up." : "Guest AI allowance unavailable."
      : denied ? "Forbidden" : "AI Insight is unavailable. Dashboard statistics remain available.",
      ...(allowance ? { resetAt: cause.resetAt ?? null } : {}), traceId },
    { status: stale ? 409 : denied ? 403 : allowance && cause.code === "EXHAUSTED" ? 429 : 503, headers });
  }
}
