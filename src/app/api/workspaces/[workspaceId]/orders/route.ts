import { NextResponse } from "next/server";

import { getServerActorContext } from "@/lib/auth/server-actor";
import {
  listWorkspaceOrders,
  WorkspaceOrderAccessError,
} from "@/lib/services/workspace-orders/listing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string }> };

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
