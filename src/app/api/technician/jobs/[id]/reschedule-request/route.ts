import { NextResponse } from "next/server";
import { z } from "zod";

import { createTechnicianRescheduleRequestSchema } from "@/domain/technician-jobs/contracts";
import { requestTechnicianJobReschedule } from "@/lib/services/technician-jobs/service";

import { technicianApiError } from "../../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = createTechnicianRescheduleRequestSchema.parse(await request.json());
    return NextResponse.json(await requestTechnicianJobReschedule(id, input), {
      status: 201,
    });
  } catch (error) {
    return technicianApiError(error);
  }
}
