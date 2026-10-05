import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";
import { readRecentWorkspaceOrders } from "@/lib/capabilities/recent-orders";
import { createWorkspaceOrder, WorkspaceOrderCommandError } from "@/lib/services/workspace-orders/commands";
import {
  WorkspaceOrderAccessError,
} from "@/lib/services/workspace-orders/listing";
import { readWorkspaceGeneration, WorkspaceGenerationError } from "@/lib/services/workspaces/generation";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const createBody = z.object({
  expectedGeneration: z.number().int().positive(),
  orderNo: z.string().min(1).max(80),
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  problemDescription: z.string().min(1).max(4000),
  serviceType: z.string().min(1).max(120),
}).strict();

export async function GET(_request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;

  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { actor, client: supabase } = workspaceContext;
    const [result, generation] = await Promise.all([
      readRecentWorkspaceOrders(actor, supabase, { workspaceId }),
      readWorkspaceGeneration(actor, supabase, workspaceId),
    ]);
    return NextResponse.json({ orders: result.orders, generation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderAccessError ||
        (error instanceof WorkspaceGenerationError && error.code === "FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Workspace orders unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { workspaceId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = createBody.safeParse(body);
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
    const order = await createWorkspaceOrder(actor, supabase, {
      workspaceId,
      ...parsed.data,
    }, guestProof);
    return NextResponse.json({ order }, { status: 201, headers: { "Cache-Control": "no-store" } });
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
