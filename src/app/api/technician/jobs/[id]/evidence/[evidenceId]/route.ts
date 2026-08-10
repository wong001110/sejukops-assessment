import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteTechnicianEvidence } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../_shared/responses";

type RouteContext = Readonly<{
  params: Promise<{ id: string; evidenceId: string }>;
}>;

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const parameters = await context.params;
    const id = z.string().uuid().parse(parameters.id);
    const evidenceId = z.string().uuid().parse(parameters.evidenceId);
    await deleteTechnicianEvidence(id, evidenceId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
