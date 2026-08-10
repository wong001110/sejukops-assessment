import { NextResponse } from "next/server";
import { z } from "zod";

import { completeTechnicianJobSchema } from "@/domain/technician-completion/contracts";
import { completeTechnicianJob } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../evidence/_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = completeTechnicianJobSchema.parse(await request.json());
    return NextResponse.json(await completeTechnicianJob(id, input));
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
