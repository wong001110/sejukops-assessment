import { testUnsavedAIProviderSchema } from "@/domain/ai-config/contracts";
import { assertAIConfigAdmin } from "@/lib/auth/ai-config-admin";
import { testUnsavedAIProvider } from "@/lib/services/ai-config/service";
import { observedAIJson } from "@/app/api/_shared/ai-provider-observation";

import { aiSettingsApiError } from "../_shared/responses";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return observedAIJson(
    request,
    "PROVIDER_TEST",
    async () => {
      await assertAIConfigAdmin();
      const input = testUnsavedAIProviderSchema.parse(await request.json());
      return testUnsavedAIProvider(input);
    },
    aiSettingsApiError,
  );
}
