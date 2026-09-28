import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { createWorkspaceOrder, WorkspaceOrderCommandError } from "@/lib/services/workspace-orders/commands";
import {
  listWorkspaceOrders,
  WorkspaceOrderAccessError,
} from "@/lib/services/workspace-orders/listing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const createBody = z.object({
  orderNo: z.string().min(1).max(80),
  branchId: z.string().uuid(),
  customerId: z.string().uuid(),
  problemDescription: z.string().min(1).max(4000),
  serviceType: z.string().min(1).max(120),
}).strict();

export async function GET(_request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;

  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const supabase = await createServerSupabaseClient();
    const orders = await listWorkspaceOrders(actor, supabase, workspaceId);
    return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderAccessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Workspace orders unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
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
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const order = await createWorkspaceOrder(actor, supabase, {
      workspaceId,
      ...parsed.data,
    });
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
