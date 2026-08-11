import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmDocumentSourceSchema } from "@/domain/document-understanding/contracts";
import { confirmDocumentSource } from "@/lib/services/document-understanding/service";

import { documentImportApiError } from "../../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = confirmDocumentSourceSchema.parse(await request.json());
    return NextResponse.json(await confirmDocumentSource(id, input));
  } catch (error) {
    return documentImportApiError(error);
  }
}
