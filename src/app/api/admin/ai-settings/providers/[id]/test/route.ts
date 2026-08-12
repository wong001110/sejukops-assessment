import { z } from "zod";

import { testSavedAIProviderSchema } from "@/domain/ai-config/contracts";
import { testSavedAIProvider } from "@/lib/services/ai-config/service";
import { observedAIJson } from "@/app/api/_shared/ai-provider-observation";

import { aiSettingsApiError } from "../../../_shared/responses";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  return observedAIJson(
    request,
    "PROVIDER_TEST",
    async () => {
      const id = z.string().uuid().parse((await context.params).id);
      const body = await request.text();
      const input = testSavedAIProviderSchema.parse(body ? JSON.parse(body) : {});
      return testSavedAIProvider(id, input);
    },
    aiSettingsApiError,
  );
}
