import { NextResponse } from "next/server";
import { z } from "zod";

import { startTechnicianJobSchema } from "@/domain/technician-jobs/contracts";
import { startTechnicianJob } from "@/lib/services/technician-jobs/service";

import { technicianApiError } from "../../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = startTechnicianJobSchema.parse(await request.json());
    return NextResponse.json(await startTechnicianJob(id, input));
  } catch (error) {
    return technicianApiError(error);
  }
}
