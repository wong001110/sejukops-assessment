import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmDocumentImportSchema } from "@/domain/document-understanding/contracts";
import { confirmDocumentImport } from "@/lib/services/document-understanding/service";

import { documentImportApiError } from "../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = confirmDocumentImportSchema.parse(await request.json());
    return NextResponse.json(await confirmDocumentImport(id, input));
  } catch (error) {
    return documentImportApiError(error);
  }
}
