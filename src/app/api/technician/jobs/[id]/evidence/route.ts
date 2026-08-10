import { NextResponse } from "next/server";
import { z } from "zod";

import { listTechnicianEvidence } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "./_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    return NextResponse.json(await listTechnicianEvidence(id));
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
