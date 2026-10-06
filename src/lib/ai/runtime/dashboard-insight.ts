import "server-only";
import { generateText, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseKnowledgeAi, type ActorContext } from "@/lib/auth/actor-policy";
import { readOperationsDashboard } from "@/lib/services/workspace-orders/dashboard";
import { dashboardHighlightCatalog, dashboardInsightSnapshot, selectDashboardHighlights } from "@/domain/operations-dashboard/insight";
import type { DashboardPeriod } from "@/domain/operations-dashboard/contracts";
import { resolveAIProviderForActorTask } from "@/lib/services/ai-config/service";
import { createSafeSDKChatModel } from "@/lib/ai/providers/safe-sdk-provider";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers/types";

export class DashboardInsightAccessError extends Error {}
export class DashboardInsightStaleError extends Error {}

export async function runDashboardInsight(actor: ActorContext, client: SupabaseClient,
  input: { workspaceId: string; period: DashboardPeriod },
  options: { guestProof?: { visitId: string; tokenHash: string }; abortSignal?: AbortSignal; beforeProviderCall?: () => Promise<void> } = {},
  dependencies: { readDashboard?: typeof readOperationsDashboard; resolveProvider?: () => Promise<AIProviderConnectionConfig>; createModel?: (provider: AIProviderConnectionConfig) => LanguageModel } = {}) {
  if (actor.membership?.workspaceId !== input.workspaceId || !canUseKnowledgeAi(actor)) throw new DashboardInsightAccessError();
  options.abortSignal?.throwIfAborted();
  const read = dependencies.readDashboard ?? readOperationsDashboard;
  const data = await read(actor, client, input, options.guestProof ?? null);
  const catalog = dashboardHighlightCatalog(data);
  const provider = await (dependencies.resolveProvider ?? (() => resolveAIProviderForActorTask(actor, "OPERATIONAL_INSIGHT")))();
  options.abortSignal?.throwIfAborted();
  await options.beforeProviderCall?.();
  options.abortSignal?.throwIfAborted();
  const result = await generateText({ model: (dependencies.createModel ?? createSafeSDKChatModel)(provider),
    system: 'Select up to three operational highlights that need attention. Return only JSON {"ids":["catalog-id"]}. Use catalog IDs exactly once. You have no tools or authority to change records. Do not invent facts or explanations.',
    prompt: JSON.stringify({ role: data.role, period: data.period, highlights: catalog }),
    maxOutputTokens: 180, maxRetries: 0, abortSignal: options.abortSignal });
  const highlights = selectDashboardHighlights(result.text, catalog);
  options.abortSignal?.throwIfAborted();
  const current = await read(actor, client, input, options.guestProof ?? null);
  options.abortSignal?.throwIfAborted();
  if (dashboardInsightSnapshot(current) !== dashboardInsightSnapshot(data)) throw new DashboardInsightStaleError();
  return { highlights, period: data.period, asOf: data.asOf, generation: data.generation,
    providerSteps: 1, usage: result.usage };
}
