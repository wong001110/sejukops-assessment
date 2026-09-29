import { NextResponse } from "next/server";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    const actor = workspaceContext?.actor;
    if (!actor || actor.membership?.workspaceId !== workspaceId ||
        actor.membership.role !== "ADMIN" || !hasActorPermission(actor, "order:assign")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const session = workspaceContext.client;
    const { data, error } = await session.from("workspace_technicians")
      .select("id,branch_id,profile_id")
      .eq("workspace_id", workspaceId).eq("active", true).limit(100);
    if (error) throw error;
    return NextResponse.json({ technicians: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Technicians unavailable" }, { status: 500 });
  }
}
