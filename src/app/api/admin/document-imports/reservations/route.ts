import { NextResponse } from "next/server";

import { reserveDocumentImportSchema } from "@/domain/document-understanding/contracts";
import { reserveDocumentImport } from "@/lib/services/document-understanding/service";

import { documentImportApiError } from "../_shared/responses";

export async function POST(request: Request) {
  try {
    const input = reserveDocumentImportSchema.parse(await request.json());
    return NextResponse.json(await reserveDocumentImport(input), { status: 201 });
  } catch (error) {
    return documentImportApiError(error);
  }
}
