import { NextResponse } from "next/server";
import { z } from "zod";

import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { getServerActorContext } from "@/lib/auth/server-actor";
import {
  AssignmentProposalError,
  proposeWorkspaceOrderAssignment,
} from "@/lib/services/workspace-orders/assignment-proposals";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const createBody = z.object({
  orderId: z.string().uuid(),
  technicianId: z.string().uuid(),
  expectedUpdatedAt: z.string(),
  scheduledAt: z.string().nullable(),
  idempotencyKey: z.string().uuid(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { workspaceId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = createBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const proposal = await proposeWorkspaceOrderAssignment(actor, supabase, {
      workspaceId, ...parsed.data,
    });
    return NextResponse.json({ proposal }, {
      status: 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentProposalError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden" : "Proposal rejected" }, {
        status: error.code === "FORBIDDEN" ? 403 : error.code === "INVALID_INPUT" ? 400 : 409,
      });
    }
    return NextResponse.json({ error: "Proposal unavailable" }, { status: 500 });
  }
}
