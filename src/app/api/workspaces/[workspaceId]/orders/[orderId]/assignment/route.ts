import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";
import { assignWorkspaceOrder, WorkspaceOrderCommandError } from "@/lib/services/workspace-orders/commands";

type RouteContext = { params: Promise<{ workspaceId: string; orderId: string }> };
const assignBody = z.object({
  expectedGeneration: z.number().int().positive(),
  technicianId: z.string().uuid(),
  expectedUpdatedAt: z.string(),
  scheduledAt: z.string().nullable(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { workspaceId, orderId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = assignBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { actor, client: supabase } = workspaceContext;
    let guestProof = null;
    if (workspaceContext.guestVisit) {
      const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
      if (!isGuestToken(token)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      guestProof = { visitId: workspaceContext.guestVisit.id, tokenHash: guestTokenHash(token) };
    }
    const order = await assignWorkspaceOrder(actor, supabase, {
      workspaceId,
      orderId,
      ...parsed.data,
    }, guestProof);
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderCommandError) {
      return NextResponse.json(
        { error: error.code === "FORBIDDEN" ? "Forbidden" : "Order command rejected" },
        { status: error.code === "FORBIDDEN" ? 403 : error.code === "INVALID_INPUT" ? 400 : 409 },
      );
    }
    return NextResponse.json({ error: "Workspace orders unavailable" }, { status: 500 });
  }
}
