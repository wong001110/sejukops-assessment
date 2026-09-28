import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { assignWorkspaceOrder, WorkspaceOrderCommandError } from "@/lib/services/workspace-orders/commands";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string; orderId: string }> };
const assignBody = z.object({
  technicianId: z.string().uuid(),
  expectedUpdatedAt: z.string(),
  scheduledAt: z.string().nullable(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
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
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const order = await assignWorkspaceOrder(actor, supabase, {
      workspaceId,
      orderId,
      ...parsed.data,
    });
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
