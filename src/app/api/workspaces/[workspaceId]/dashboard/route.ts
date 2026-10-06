import { NextResponse } from "next/server";
import { dashboardPeriodSchema } from "@/domain/operations-dashboard/contracts";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { readOperationsDashboard } from "@/lib/services/workspace-orders/dashboard";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";
import { WorkspaceGenerationError } from "@/lib/services/workspaces/generation";
import { cookies } from "next/headers";
import { GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const period = dashboardPeriodSchema.safeParse(new URL(request.url).searchParams.get("period") ?? "this_week");
  if (!period.success) return NextResponse.json({ error: "Invalid dashboard period" }, { status: 400 });
  try {
    const resolved = await getWorkspaceRequestContext(workspaceId);
    if (!resolved) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    let guestProof = null;
    if (resolved.guestVisit) {
      const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
      if (!isGuestToken(token)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      guestProof = { visitId: resolved.guestVisit.id, tokenHash: guestTokenHash(token) };
    }
    const dashboard = await readOperationsDashboard(resolved.actor, resolved.client, { workspaceId, period: period.data }, guestProof);
    return NextResponse.json({ dashboard }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderAccessError || (error instanceof WorkspaceGenerationError && error.code === "FORBIDDEN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Dashboard unavailable. Refresh to try again." }, { status: 503 });
  }
}
