import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";
import { ManagerRescheduleError, rescheduleManagerOrder } from "@/lib/services/workspace-orders/manager-reschedule";

type RouteContext = { params: Promise<{ workspaceId: string; orderId: string }> };
const bodySchema = z.object({
  expectedGeneration: z.number().int().positive(),
  expectedUpdatedAt: z.string(),
  scheduledAt: z.string(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { workspaceId, orderId } = await context.params;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const resolved = await getWorkspaceRequestContext(workspaceId);
    if (!resolved) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    let guestProof = null;
    if (resolved.guestVisit) {
      const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
      if (!isGuestToken(token)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      guestProof = { visitId: resolved.guestVisit.id, tokenHash: guestTokenHash(token) };
    }
    const order = await rescheduleManagerOrder(resolved.actor, resolved.client, {
      workspaceId, orderId, ...parsed.data,
    }, guestProof);
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ManagerRescheduleError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden" : "Schedule update rejected; refresh and retry." }, {
        status: error.code === "FORBIDDEN" ? 403 : error.code === "INVALID_INPUT" ? 400 : 409,
      });
    }
    return NextResponse.json({ error: "Workspace orders unavailable" }, { status: 500 });
  }
}
