import { NextResponse } from "next/server";
import { z } from "zod";

import { directRescheduleSchema } from "@/domain/admin-orders/contracts";
import { directlyRescheduleAdminOrder } from "@/lib/services/admin-orders/service";

import { adminApiError } from "../../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = directRescheduleSchema.parse(await request.json());
    return NextResponse.json(await directlyRescheduleAdminOrder(id, input));
  } catch (error) {
    return adminApiError(error);
  }
}
