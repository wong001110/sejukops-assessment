import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteTechnicianPaymentReceipt } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../../evidence/_shared/responses";

type RouteContext = Readonly<{
  params: Promise<{ id: string; receiptId: string }>;
}>;

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const parameters = await context.params;
    const id = z.string().uuid().parse(parameters.id);
    const receiptId = z.string().uuid().parse(parameters.receiptId);
    await deleteTechnicianPaymentReceipt(id, receiptId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
