import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { AIConfigError } from "@/domain/ai-config/errors";
import {
  workflowExplanationRequestSchema,
  workflowExplanationResponseSchema,
  workflowFlagSchema,
  type WorkflowExplanationRequest,
  type WorkflowExplanationResponse,
  type WorkflowExplanationSafeErrorCode,
  type WorkflowFlag,
} from "@/domain/workflow-supervisor/contracts";
import {
  WORKFLOW_SUPERVISOR_MESSAGES,
  WorkflowSupervisorError,
} from "@/domain/workflow-supervisor/errors";
import {
  requestAIProviderCompletion,
  type AIChatCompletionDependencies,
  type AIChatCompletionResult,
  type AIProviderConnectionConfig,
} from "@/lib/ai/providers";
import { resolveAIProviderForTask } from "@/lib/services/ai-config/service";
import {
  createAuthorizedDataContext,
  type AuthorizedDataContext,
} from "@/lib/supabase/privileged-server";

const beginResultSchema = z
  .object({
    action: z.enum(["EXECUTE", "REPLAY", "CACHED"]),
    flag: workflowFlagSchema,
    replayed: z.boolean(),
  })
  .strict();

const modelStatementSchema = z
  .object({
    text: z.string().trim().min(1).max(1_000),
    factKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  })
  .strict();

const modelResponseSchema = z
  .object({
    summary: modelStatementSchema,
    recommendation: modelStatementSchema,
  })
  .strict();

type ProviderWithId = AIProviderConnectionConfig & {
  providerConfigId?: string | null;
};

export type WorkflowSupervisorDependencies = Readonly<{
  createContext?: () => Promise<AuthorizedDataContext>;
  resolveProvider?: (
    task: "WORKFLOW_EXPLANATION",
  ) => Promise<ProviderWithId>;
  complete?: typeof requestAIProviderCompletion;
  provider?: AIChatCompletionDependencies;
}>;

function dataError(error: { message?: string } | null): never {
  const message = error?.message ?? "";
  if (message.includes("INVALID_MANAGER_ACTOR")) {
    throw new WorkflowSupervisorError(
      "WORKFLOW_SUPERVISOR_PERMISSION_DENIED",
      WORKFLOW_SUPERVISOR_MESSAGES.WORKFLOW_SUPERVISOR_PERMISSION_DENIED,
      403,
    );
  }
  if (message.includes("WORKFLOW_FLAG_NOT_FOUND")) {
    throw new WorkflowSupervisorError(
      "WORKFLOW_FLAG_NOT_FOUND",
      WORKFLOW_SUPERVISOR_MESSAGES.WORKFLOW_FLAG_NOT_FOUND,
      404,
    );
  }
  if (
    message.includes("WORKFLOW_EXPLANATION_IDEMPOTENCY_CONFLICT") ||
    message.includes("WORKFLOW_EXPLANATION_IN_PROGRESS")
  ) {
    throw new WorkflowSupervisorError(
      "WORKFLOW_EXPLANATION_CONFLICT",
      WORKFLOW_SUPERVISOR_MESSAGES.WORKFLOW_EXPLANATION_CONFLICT,
      409,
      true,
    );
  }
  throw new WorkflowSupervisorError(
    "WORKFLOW_SUPERVISOR_DATA_ACCESS_FAILED",
    WORKFLOW_SUPERVISOR_MESSAGES.WORKFLOW_SUPERVISOR_DATA_ACCESS_FAILED,
    503,
    true,
  );
}

async function managerContext(): Promise<AuthorizedDataContext> {
  const context = await createAuthorizedDataContext("review:view");
  if (context.identity.role !== "MANAGER") {
    throw new WorkflowSupervisorError(
      "WORKFLOW_SUPERVISOR_PERMISSION_DENIED",
      WORKFLOW_SUPERVISOR_MESSAGES.WORKFLOW_SUPERVISOR_PERMISSION_DENIED,
      403,
    );
  }
  return context;
}

async function rpc(
  supabase: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(functionName, parameters);
  if (error) dataError(error);
  return data;
}

type GroundingFact = Readonly<{ key: string; value: string | number | boolean }>;

function groundingFacts(flag: WorkflowFlag): readonly GroundingFact[] {
  const facts: GroundingFact[] = [
    { key: "flag.rule_code", value: flag.ruleCode },
    { key: "flag.completion_revision", value: flag.completionRevision },
    { key: "flag.severity", value: flag.severity },
    { key: "flag.deterministic_summary", value: flag.deterministicSummary },
  ];
  for (const [key, value] of Object.entries(flag.details)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      facts.push({ key: `details.${key}`, value });
    }
  }
  return facts;
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const candidates: unknown[] = [];
    let depth = 0;
    let start = -1;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") {
        if (depth === 0) start = index;
        depth += 1;
      } else if (character === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          try {
            candidates.push(JSON.parse(content.slice(start, index + 1)));
          } catch {
            // Continue scanning for one unambiguous valid object.
          }
          start = -1;
        }
      }
    }
    if (candidates.length === 1) return candidates[0];
    throw new Error("Expected exactly one valid JSON object");
  }
}

function assertGroundedStatement(
  text: string,
  factKeys: readonly string[],
  facts: readonly GroundingFact[],
): void {
  const map = new Map(facts.map((fact) => [fact.key, fact]));
  const cited = factKeys.map((key) => {
    const fact = map.get(key);
    if (!fact) throw new Error("Unknown workflow fact citation");
    return fact;
  });
  const allowedNumbers = cited
    .filter((fact) => typeof fact.value === "number")
    .map((fact) => Number(fact.value));
  for (const match of text.matchAll(/(-?\d+(?:\.\d+)?)/g)) {
    const numeric = Number(match[1]);
    if (!allowedNumbers.some((value) => Math.abs(value - numeric) < 0.005)) {
      throw new Error("Uncited numeric workflow claim");
    }
  }
}

function safeProviderCode(error: unknown): WorkflowExplanationSafeErrorCode {
  if (error instanceof AIConfigError) {
    if (
      error.code === "AI_NOT_CONFIGURED" ||
      error.code === "AI_AUTH_FAILED" ||
      error.code === "AI_RATE_LIMITED" ||
      error.code === "AI_TIMEOUT" ||
      error.code === "AI_PROVIDER_UNAVAILABLE" ||
      error.code === "AI_INVALID_RESPONSE" ||
      error.code === "AI_CAPABILITY_MISMATCH"
    ) {
      return error.code;
    }
  }
  return "AI_PROVIDER_UNAVAILABLE";
}

async function storeOutcome(
  context: AuthorizedDataContext,
  flagId: string,
  requestKey: string,
  input:
    | Readonly<{
        status: "AVAILABLE";
        summary: string;
        recommendation: string;
        providerConfigId: string | null;
      }>
    | Readonly<{
        status: "UNAVAILABLE";
        errorCode: WorkflowExplanationSafeErrorCode;
        providerConfigId: string | null;
      }>,
): Promise<WorkflowExplanationResponse> {
  const data = await rpc(
    context.supabase,
    "manager_store_workflow_flag_explanation",
    {
      p_actor_profile_id: context.identity.profileId,
      p_flag_id: flagId,
      p_request_key: requestKey,
      p_explanation_status: input.status,
      p_summary: input.status === "AVAILABLE" ? input.summary : null,
      p_recommendation:
        input.status === "AVAILABLE" ? input.recommendation : null,
      p_error_code: input.status === "UNAVAILABLE" ? input.errorCode : null,
      p_provider_config_id: input.providerConfigId,
    },
  );
  return workflowExplanationResponseSchema.parse(data);
}

export async function explainWorkflowFlag(
  flagId: string,
  rawRequest: WorkflowExplanationRequest,
  dependencies: WorkflowSupervisorDependencies = {},
): Promise<WorkflowExplanationResponse> {
  const request = workflowExplanationRequestSchema.parse(rawRequest);
  const context = await (dependencies.createContext ?? managerContext)();
  if (context.identity.role !== "MANAGER") {
    throw new WorkflowSupervisorError(
      "WORKFLOW_SUPERVISOR_PERMISSION_DENIED",
      WORKFLOW_SUPERVISOR_MESSAGES.WORKFLOW_SUPERVISOR_PERMISSION_DENIED,
      403,
    );
  }
  const begin = beginResultSchema.parse(
    await rpc(context.supabase, "manager_begin_workflow_flag_explanation", {
      p_actor_profile_id: context.identity.profileId,
      p_flag_id: flagId,
      p_request_key: request.requestKey,
    }),
  );
  if (begin.action !== "EXECUTE") {
    return workflowExplanationResponseSchema.parse({
      flag: begin.flag,
      replayed: begin.replayed,
    });
  }

  let provider: ProviderWithId | null = null;
  try {
    provider = await (
      dependencies.resolveProvider ??
      ((task) => resolveAIProviderForTask(task))
    )("WORKFLOW_EXPLANATION");
    const facts = groundingFacts(begin.flag);
    const completion: AIChatCompletionResult = await (
      dependencies.complete ?? requestAIProviderCompletion
    )(
      provider,
      {
        messages: [
          {
            role: "system",
            content:
              "Explain only the supplied deterministic SejukOps workflow flag facts. Return one JSON object with summary and recommendation; each contains text and exact factKeys. Do not infer causes, blame staff, or introduce uncited amounts, ratios, counts, dates, or operational facts. Recommend only a human review step. Never approve, reject, refund, charge, or discipline automatically.",
          },
          {
            role: "user",
            content: JSON.stringify({
              flag: {
                ruleCode: begin.flag.ruleCode,
                severity: begin.flag.severity,
                deterministicSummary: begin.flag.deterministicSummary,
              },
              facts,
              schema: {
                summary: { text: "string", factKeys: ["exact.fact.key"] },
                recommendation: {
                  text: "string",
                  factKeys: ["exact.fact.key"],
                },
              },
            }),
          },
        ],
        maxTokens: 450,
        responseFormat: "JSON_OBJECT",
      },
      dependencies.provider,
    );
    const model = modelResponseSchema.parse(extractJsonObject(completion.content));
    assertGroundedStatement(model.summary.text, model.summary.factKeys, facts);
    assertGroundedStatement(
      model.recommendation.text,
      model.recommendation.factKeys,
      facts,
    );
    return storeOutcome(context, flagId, request.requestKey, {
      status: "AVAILABLE",
      summary: model.summary.text,
      recommendation: model.recommendation.text,
      providerConfigId: provider.providerConfigId ?? null,
    });
  } catch (error) {
    return storeOutcome(context, flagId, request.requestKey, {
      status: "UNAVAILABLE",
      errorCode:
        error instanceof z.ZodError ||
        (error instanceof Error &&
          (error.message.includes("workflow fact") ||
            error.message.includes("numeric workflow") ||
            error.message.includes("JSON object")))
          ? "AI_INVALID_RESPONSE"
          : safeProviderCode(error),
      providerConfigId: provider?.providerConfigId ?? null,
    });
  }
}
