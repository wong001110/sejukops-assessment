import { NextResponse } from "next/server";
import { z } from "zod";

import { reserveEvidenceUploadSchema } from "@/domain/technician-completion/contracts";
import { reserveTechnicianEvidence } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = reserveEvidenceUploadSchema.parse(await request.json());
    return NextResponse.json(await reserveTechnicianEvidence(id, input), { status: 201 });
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
