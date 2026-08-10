import { NextResponse } from "next/server";
import { z } from "zod";

import { getTechnicianJobDetail } from "@/lib/services/technician-jobs/service";

import { technicianApiError } from "../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    return NextResponse.json(await getTechnicianJobDetail(id));
  } catch (error) {
    return technicianApiError(error);
  }
}
