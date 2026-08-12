import { z } from "zod";

import { extractDocumentImportSchema } from "@/domain/document-understanding/contracts";
import { extractDocumentImport } from "@/lib/services/document-understanding/service";
import { observedAIJson } from "@/app/api/_shared/ai-provider-observation";

import { documentImportApiError } from "../../_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  return observedAIJson(
    request,
    "DOCUMENT_UNDERSTANDING",
    async () => {
      const { id: candidate } = await context.params;
      const id = z.string().uuid().parse(candidate);
      const input = extractDocumentImportSchema.parse(await request.json());
      return extractDocumentImport(id, input);
    },
    documentImportApiError,
  );
}
