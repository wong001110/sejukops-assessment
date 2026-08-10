import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmEvidenceUploadSchema } from "@/domain/technician-completion/contracts";
import { confirmTechnicianEvidence } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../../_shared/responses";

type RouteContext = Readonly<{
  params: Promise<{ id: string; evidenceId: string }>;
}>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const parameters = await context.params;
    const id = z.string().uuid().parse(parameters.id);
    const evidenceId = z.string().uuid().parse(parameters.evidenceId);
    const input = confirmEvidenceUploadSchema.parse(await request.json());
    return NextResponse.json(await confirmTechnicianEvidence(id, evidenceId, input));
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
