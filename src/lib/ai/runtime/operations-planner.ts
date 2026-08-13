import "server-only";

import { z } from "zod";

import {
  OPERATIONS_TOOL_NAMES,
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

const APPROVED_TOOL_NAMES = OPERATIONS_TOOL_NAMES;

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
    intent: z.string().trim().min(1).max(64).optional(),
    toolName: z.enum(APPROVED_TOOL_NAMES),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
const plannerResponseSchema = z.discriminatedUnion("outcome", [
  toolPlanSchema,
  unsupportedPlanSchema,
  clarificationPlanSchema,
]);

type PlannerResponse = z.infer<typeof plannerResponseSchema>;

function balancedJsonObjects(content: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function isUnapprovedToolPlan(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (object.outcome !== "TOOL" || typeof object.toolName !== "string") {
    return false;
  }
  return !APPROVED_TOOL_NAMES.includes(
    object.toolName as (typeof APPROVED_TOOL_NAMES)[number],
  );
}

export function parseOperationsPlanContent(content: string): PlannerResponse {
  const parsed: PlannerResponse[] = [];
  const diagnostics: string[] = [];
  let unapprovedToolPlans = 0;

  for (const candidate of balancedJsonObjects(content)) {
    try {
      const raw = JSON.parse(candidate) as unknown;
      if (isUnapprovedToolPlan(raw)) {
        unapprovedToolPlans += 1;
        diagnostics.push("unapproved_tool");
        continue;
      }
      const result = plannerResponseSchema.safeParse(raw);
      if (result.success) parsed.push(result.data);
      else {
        diagnostics.push(
          result.error.issues
            .map(({ code, path }) => `${path.join(".")}:${code}`)
            .join(","),
        );
      }
    } catch {
      diagnostics.push("json_syntax");
    }
  }

  if (parsed.length === 1) return parsed[0];
  if (parsed.length === 0 && unapprovedToolPlans === 1) {
    return { outcome: "UNSUPPORTED" };
  }
  throw new Error(
    `Provider returned no unique valid operations plan (${diagnostics.join(";") || "no_json_object"})`,
  );
}

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

const TOOL_INTENT: Readonly<Record<OperationsToolName, SupportedOperationIntent>> = {
  getJobs: "JOBS_LOOKUP",
  getTechnicianStats: "TECHNICIAN_PERFORMANCE",
  getOperationalSummary: "OPERATIONAL_SUMMARY",
  getWorkload: "WORKLOAD",
};

const SYSTEM_PROMPT = `You are the SejukOps operations request planner. Return one JSON object only.
You may select exactly one approved tool, ask a clarification, or mark the request unsupported.
If none of the approved tools can answer the request, return UNSUPPORTED. Never invent or name a new tool.
Never emit SQL, table names, database instructions, or any tool outside this list.
Array filters are bounded to 1..10 values. Multiple values inside one filter mean OR; different filters combine with AND.
Supported scopes:
- getJobs: direct order status/details or bounded job lists. Arguments: period? (today|this_week|last_week|this_month), technicianNames? string[], statuses? (NEW|ASSIGNED|IN_PROGRESS|JOB_DONE|REVIEWED|CLOSED)[], serviceTypes? string[], orderNumbers? string[], completedOnly boolean, limit 1..25. Require period or orderNumbers. Use completedOnly=true when the user asks jobs that were completed; current lifecycle status may later be REVIEWED/CLOSED. Put every explicitly requested order number in orderNumbers, up to 10.
- getTechnicianStats: completion counts, amounts, ranking, or comparison. Arguments: period, technicianNames? string[], limit 1..25. Include every explicitly named technician, up to 10.
- getOperationalSummary: completed job count or total amount. Arguments: period.
- getWorkload: active ASSIGNED/IN_PROGRESS workload or technician comparison. Arguments: period, technicianNames? string[], limit 1..25. Include every explicitly named technician, up to 10.
Periods are symbolic because the server owns Asia/Kuala_Lumpur boundaries. Never provide start/end dates.
Valid TOOL shape: {"outcome":"TOOL","toolName":"...","arguments":{...}}. The server derives intent from the approved tool name.
Valid clarification shape: {"outcome":"CLARIFICATION","question":"...","context":null or supplied bounded context}.
Valid unsupported shape: {"outcome":"UNSUPPORTED"}.
Examples:
{"outcome":"TOOL","toolName":"getJobs","arguments":{"period":"last_week","technicianNames":["Ali"],"completedOnly":true,"limit":20}}
{"outcome":"TOOL","toolName":"getJobs","arguments":{"orderNumbers":["ORD-2026-0038","ORD-2026-0037"],"completedOnly":false,"limit":2}}
{"outcome":"TOOL","toolName":"getTechnicianStats","arguments":{"period":"this_week","technicianNames":["Ali","Bala"],"limit":2}}
Omit optional fields that do not apply. Never emit null argument fields, extra keys, reasoning, prose, or Markdown.
Use supplied current-conversation context only to resolve a follow-up such as "What about Bala?" or "What about those two orders?". Current question overrides context. A context-free ambiguous follow-up requires CLARIFICATION. Weather, destructive actions, arbitrary database/SQL access, raw database dumps, and non-operational requests are UNSUPPORTED.`;

function omitNullArguments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null),
  );
}

function parseToolArguments(
  name: OperationsToolName,
  value: unknown,
): OperationsToolArguments {
  const normalized = omitNullArguments(value);
  if (name === "getJobs") return getJobsArgumentsSchema.parse(normalized);
  if (name === "getTechnicianStats") {
    return getTechnicianStatsArgumentsSchema.parse(normalized);
  }
  if (name === "getOperationalSummary") {
    return getOperationalSummaryArgumentsSchema.parse(normalized);
  }
  return getWorkloadArgumentsSchema.parse(normalized);
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
  const parsed = parseOperationsPlanContent(completion.content);
  if (parsed.outcome !== "TOOL") return { plan: parsed, completion };
  return {
    plan: {
      outcome: "TOOL",
      intent: TOOL_INTENT[parsed.toolName],
      toolName: parsed.toolName,
      arguments: parseToolArguments(parsed.toolName, parsed.arguments),
    },
    completion,
  };
}
