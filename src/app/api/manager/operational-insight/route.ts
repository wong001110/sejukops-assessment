import { operationalInsightRequestSchema } from "@/domain/ai-operations/contracts";
import { getOperationalInsight } from "@/lib/services/ai-operations/operational-insight";
import { observedAIJson } from "@/app/api/_shared/ai-provider-observation";

import { aiOperationsApiError } from "../ai-operations/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return observedAIJson(
    request,
    "OPERATIONAL_INSIGHT",
    async () => {
      const input = operationalInsightRequestSchema.parse(await request.json());
      return getOperationalInsight(input);
    },
    aiOperationsApiError,
  );
}
