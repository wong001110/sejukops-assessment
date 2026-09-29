import { NextResponse } from "next/server";
import { z } from "zod";

import { ProviderAllowanceError, runWorkspaceOrdersAgent, WorkspaceOrdersAgentError } from "@/lib/ai/runtime/workspace-orders-agent";
import { reserveDemoAiCall } from "@/lib/ai/runtime/demo-ai-budget";
import { reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const bodySchema = z.object({ question: z.string().trim().min(1).max(1_000) }).strict();

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

  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { actor, client: supabase, guestVisit } = workspaceContext;
    if (actor.membership?.workspaceId !== workspaceId
        || !hasActorPermission(actor, "ai:use")
        || !hasActorPermission(actor, "order:view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!guestVisit && actor.membership.kind === "DEMO"
        && !await reserveDemoAiCall(actor, workspaceId, request.headers)) {
      return NextResponse.json({ error: "Demo AI limit reached or unavailable" }, { status: 429 });
    }
    const result = await runWorkspaceOrdersAgent(
      actor, supabase, { workspaceId, question: parsed.data.question },
      {
        abortSignal: request.signal,
        beforeProviderCall: guestVisit ? async () => {
          const reservation = await reserveGuestAiCall(guestVisit);
          if (!reservation) throw new ProviderAllowanceError("UNAVAILABLE");
          if (!reservation.allowed) throw new ProviderAllowanceError("EXHAUSTED", reservation.resetAt);
        } : undefined,
      },
    );
    // The runtime discards provider prose; only scoped tool evidence and a
    // deterministic summary reach the browser.
    return NextResponse.json({ answer: result.answer, orders: result.orders },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ProviderAllowanceError) {
      return NextResponse.json({
        error: error.code === "EXHAUSTED"
          ? "Today's Guest AI allowance is used up. Please return after the Malaysia-time reset."
          : "Guest AI is temporarily unavailable. Manual Demo actions still work.",
        resetAt: error.resetAt ?? null,
      }, { status: error.code === "EXHAUSTED" ? 429 : 503 });
    }
    if (error instanceof WorkspaceOrderAccessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof WorkspaceOrdersAgentError) {
      return NextResponse.json({ error: "AI Assist unavailable; use the order list" }, { status: 503 });
    }
    return NextResponse.json({ error: "AI Assist unavailable; use the order list" }, { status: 500 });
  }
}
