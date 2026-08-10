import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminOrderDetail } from "@/lib/services/admin-orders/service";

import { adminApiError } from "../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    return NextResponse.json(await getAdminOrderDetail(id));
  } catch (error) {
    return adminApiError(error);
  }
}
