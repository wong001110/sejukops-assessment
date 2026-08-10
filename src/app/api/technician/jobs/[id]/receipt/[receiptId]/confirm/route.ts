import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmEvidenceUploadSchema } from "@/domain/technician-completion/contracts";
import { confirmTechnicianPaymentReceipt } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../../../evidence/_shared/responses";

type RouteContext = Readonly<{
  params: Promise<{ id: string; receiptId: string }>;
}>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const parameters = await context.params;
    const id = z.string().uuid().parse(parameters.id);
    const receiptId = z.string().uuid().parse(parameters.receiptId);
    const input = confirmEvidenceUploadSchema.parse(await request.json());
    return NextResponse.json(
      await confirmTechnicianPaymentReceipt(id, receiptId, input),
    );
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
