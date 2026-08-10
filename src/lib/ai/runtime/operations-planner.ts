import "server-only";

import { z } from "zod";

import {
  conversationContextSchema,
  getJobsArgumentsSchema,
  getOperationalSummaryArgumentsSchema,
  getTechnicianStatsArgumentsSchema,
  getWorkloadArgumentsSchema,
  type AIOperationsRequest,
  type ConversationContext,
  type OperationsToolArguments,
  type OperationsToolName,
  type SupportedOperationIntent,
} from "@/domain/ai-operations/contracts";
import type {
  AIChatCompletionDependencies,
  AIChatCompletionResult,
  AIProviderConnectionConfig,
} from "@/lib/ai/providers";
import { requestAIProviderCompletion } from "@/lib/ai/providers";

const unsupportedPlanSchema = z
  .object({ outcome: z.literal("UNSUPPORTED") })
  .strict();
const clarificationPlanSchema = z
  .object({
    outcome: z.literal("CLARIFICATION"),
    question: z.string().trim().min(1).max(500),
    context: conversationContextSchema.nullable().default(null),
  })
  .strict();
const toolPlanSchema = z
  .object({
    outcome: z.literal("TOOL"),
    intent: z.enum([
      "JOBS_LOOKUP",
      "TECHNICIAN_PERFORMANCE",
      "OPERATIONAL_SUMMARY",
      "WORKLOAD",
    ]),
    toolName: z.enum([
      "getJobs",
      "getTechnicianStats",
      "getOperationalSummary",
      "getWorkload",
    ]),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
const plannerResponseSchema = z.discriminatedUnion("outcome", [
  toolPlanSchema,
  unsupportedPlanSchema,
  clarificationPlanSchema,
]);

export type OperationsPlan =
  | Readonly<{ outcome: "UNSUPPORTED" }>
  | Readonly<{
      outcome: "CLARIFICATION";
      question: string;
      context: ConversationContext | null;
    }>
  | Readonly<{
      outcome: "TOOL";
      intent: SupportedOperationIntent;
      toolName: OperationsToolName;
      arguments: OperationsToolArguments;
    }>;

const INTENT_TOOL: Readonly<Record<SupportedOperationIntent, OperationsToolName>> = {
  JOBS_LOOKUP: "getJobs",
  TECHNICIAN_PERFORMANCE: "getTechnicianStats",
  OPERATIONAL_SUMMARY: "getOperationalSummary",
  WORKLOAD: "getWorkload",
};

const SYSTEM_PROMPT = `You are the SejukOps operations request planner. Return one JSON object only.
You may select exactly one approved tool, ask a clarification, or mark the request unsupported.
Never emit SQL, table names, database instructions, or any tool outside this list.
Supported scopes:
- getJobs: direct order status/details or bounded job lists. Arguments: period? (today|this_week|last_week|this_month), technicianName?, status? (NEW|ASSIGNED|IN_PROGRESS|JOB_DONE|REVIEWED|CLOSED), serviceType?, orderNumber?, completedOnly boolean, limit 1..25. Require period or orderNumber. Use completedOnly=true when the user asks jobs that were completed; current lifecycle status may later be REVIEWED/CLOSED.
- getTechnicianStats: completion counts, amounts, or ranking. Arguments: period, technicianName?, limit 1..25.
- getOperationalSummary: completed job count or total amount. Arguments: period.
- getWorkload: active ASSIGNED/IN_PROGRESS workload. Arguments: period, technicianName?, limit 1..25.
Periods are symbolic because the server owns Asia/Kuala_Lumpur boundaries. Never provide start/end dates.
Valid TOOL shape: {"outcome":"TOOL","intent":"...","toolName":"...","arguments":{...}}.
Valid clarification shape: {"outcome":"CLARIFICATION","question":"...","context":null or supplied bounded context}.
Valid unsupported shape: {"outcome":"UNSUPPORTED"}.
Use supplied current-conversation context only to resolve a follow-up such as "What about Bala?". Current question overrides context. A context-free ambiguous follow-up requires CLARIFICATION. Weather, destructive actions, arbitrary database/SQL access, raw database dumps, and non-operational requests are UNSUPPORTED.`;

function parseToolArguments(
  name: OperationsToolName,
  value: unknown,
): OperationsToolArguments {
  if (name === "getJobs") return getJobsArgumentsSchema.parse(value);
  if (name === "getTechnicianStats") {
    return getTechnicianStatsArgumentsSchema.parse(value);
  }
  if (name === "getOperationalSummary") {
    return getOperationalSummaryArgumentsSchema.parse(value);
  }
  return getWorkloadArgumentsSchema.parse(value);
}

export type OperationsPlannerDependencies = Readonly<{
  complete?: typeof requestAIProviderCompletion;
  provider?: AIChatCompletionDependencies;
}>;

export async function planOperationsRequest(
  provider: AIProviderConnectionConfig,
  request: AIOperationsRequest,
  dependencies: OperationsPlannerDependencies = {},
): Promise<Readonly<{ plan: OperationsPlan; completion: AIChatCompletionResult }>> {
  const completion = await (dependencies.complete ?? requestAIProviderCompletion)(
    provider,
    {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question: request.question,
            context: request.context ?? null,
          }),
        },
      ],
      maxTokens: 450,
      responseFormat: "JSON_OBJECT",
    },
    dependencies.provider,
  );
  const parsed = plannerResponseSchema.parse(JSON.parse(completion.content));
  if (parsed.outcome !== "TOOL") return { plan: parsed, completion };
  if (INTENT_TOOL[parsed.intent] !== parsed.toolName) {
    throw new Error("Planner intent/tool mismatch");
  }
  return {
    plan: {
      ...parsed,
      arguments: parseToolArguments(parsed.toolName, parsed.arguments),
    },
    completion,
  };
}
