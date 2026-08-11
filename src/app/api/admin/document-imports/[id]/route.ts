import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocumentImport } from "@/lib/services/document-understanding/service";

import { documentImportApiError } from "../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    return NextResponse.json(await getDocumentImport(id));
  } catch (error) {
    return documentImportApiError(error);
  }
}
