import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { WorkspaceOrderCommandError } from "@/lib/services/workspace-orders/commands";
import { confirmWorkspaceOrderIntake } from "@/lib/services/workspace-order-intake/confirm";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string }> };
const bodySchema = z.object({
  confirmed: z.literal(true),
  expectedGeneration: z.number().int().positive(),
  orderNo: z.string().trim().min(1).max(80),
  branchId: z.string().uuid(),
  customer: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("EXISTING"), customerId: z.string().uuid() }).strict(),
    z.object({ mode: z.literal("NEW"), name: z.string().trim().min(1).max(160),
      phone: z.string().regex(/^\+?[0-9][0-9 -]{6,20}$/).nullable(),
      address: z.string().trim().min(1).max(800) }).strict(),
  ]),
  problemDescription: z.string().trim().min(1).max(4000),
  serviceType: z.string().trim().min(1).max(120),
}).strict();

/** A separate human action; this path never trusts model approval or fields. */
export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { workspaceId } = await context.params;
  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const fields = parsed.data;
    const order = await confirmWorkspaceOrderIntake(actor, supabase, {
      workspaceId,
      expectedGeneration: fields.expectedGeneration,
      orderNo: fields.orderNo,
      branchId: fields.branchId,
      customer: fields.customer,
      problemDescription: fields.problemDescription,
      serviceType: fields.serviceType,
    });
    return NextResponse.json({ order }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderCommandError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden" : "Order command rejected" },
        { status: error.code === "FORBIDDEN" ? 403 : error.code === "INVALID_INPUT" ? 400 : 409 });
    }
    return NextResponse.json({ error: "Order unavailable" }, { status: 500 });
  }
}
