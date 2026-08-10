import { NextResponse } from "next/server";
import { z } from "zod";

import { reservePaymentReceiptSchema } from "@/domain/technician-completion/contracts";
import { reserveTechnicianPaymentReceipt } from "@/lib/services/technician-completion/service";

import { technicianCompletionApiError } from "../../evidence/_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = reservePaymentReceiptSchema.parse(await request.json());
    return NextResponse.json(await reserveTechnicianPaymentReceipt(id, input), {
      status: 201,
    });
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
