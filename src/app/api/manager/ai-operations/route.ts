import { aiOperationsRequestSchema } from "@/domain/ai-operations/contracts";
import { runAIOperations } from "@/lib/ai/runtime/operations-orchestrator";
import { observedAIJson } from "@/app/api/_shared/ai-provider-observation";

import { aiOperationsApiError } from "./responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return observedAIJson(
    request,
    "OPERATIONS_QUERY",
    async () => {
      const input = aiOperationsRequestSchema.parse(await request.json());
      return runAIOperations(input);
    },
    aiOperationsApiError,
  );
}
