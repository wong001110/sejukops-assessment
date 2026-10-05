import { NextResponse } from "next/server";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { readWorkspaceTechnicians } from "@/lib/services/workspace-orders/technicians";

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
    const technicians = await readWorkspaceTechnicians(actor, workspaceContext.client, workspaceId);
    return NextResponse.json({ technicians }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Technicians unavailable" }, { status: 500 });
  }
}
