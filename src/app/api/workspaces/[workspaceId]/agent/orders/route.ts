import { NextResponse } from "next/server";
import { z } from "zod";

import { runWorkspaceOrdersAgent, WorkspaceOrdersAgentError } from "@/lib/ai/runtime/workspace-orders-agent";
import { reserveDemoAiCall } from "@/lib/ai/runtime/demo-ai-budget";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (actor.membership?.workspaceId !== workspaceId
        || !hasActorPermission(actor, "ai:use")
        || !hasActorPermission(actor, "order:view")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (actor.membership.kind === "DEMO"
        && !await reserveDemoAiCall(actor, workspaceId, request.headers)) {
      return NextResponse.json({ error: "Demo AI limit reached or unavailable" }, { status: 429 });
    }
    const supabase = await createServerSupabaseClient();
    const result = await runWorkspaceOrdersAgent(
      actor, supabase, { workspaceId, question: parsed.data.question },
      { abortSignal: request.signal },
    );
    // The runtime discards provider prose; only scoped tool evidence and a
    // deterministic summary reach the browser.
    return NextResponse.json({ answer: result.answer, orders: result.orders },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderAccessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof WorkspaceOrdersAgentError) {
      return NextResponse.json({ error: "AI Assist unavailable; use the order list" }, { status: 503 });
    }
    return NextResponse.json({ error: "AI Assist unavailable; use the order list" }, { status: 500 });
  }
}
