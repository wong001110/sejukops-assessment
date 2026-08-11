import { NextResponse } from "next/server";
import { z } from "zod";

import { extractDocumentImportSchema } from "@/domain/document-understanding/contracts";
import { extractDocumentImport } from "@/lib/services/document-understanding/service";

import { documentImportApiError } from "../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = extractDocumentImportSchema.parse(await request.json());
    return NextResponse.json(await extractDocumentImport(id, input));
  } catch (error) {
    return documentImportApiError(error);
  }
}
