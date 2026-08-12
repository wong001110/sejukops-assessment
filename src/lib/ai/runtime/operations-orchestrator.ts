import "server-only";

import { ZodError } from "zod";

import {
  aiOperationsRequestSchema,
  aiOperationsResponseSchema,
  type AIOperationsRequest,
  type AIOperationsResponse,
  type OperationsToolName,
} from "@/domain/ai-operations/contracts";
import {
  AI_OPERATIONS_MESSAGES,
  AIOperationsError,
} from "@/domain/ai-operations/errors";
import { AIConfigError } from "@/domain/ai-config/errors";
import type {
  AIChatCompletionResult,
  AIProviderConnectionConfig,
} from "@/lib/ai/providers";
import { resolveAIProviderForTask } from "@/lib/services/ai-config/service";
import {
  assertGroundedOperationsAnswer,
  buildOperationsFacts,
  buildOperationsPresentation,
  contextFromExecution,
  formatGroundedOperationsAnswer,
} from "@/lib/services/ai-operations/grounding";
import {
  createManagerAIDataContext,
  executeOperationsTool,
  type ExecutedOperationsTool,
} from "@/lib/services/ai-operations/tools";

import {
  planOperationsRequest,
  type OperationsPlannerDependencies,
} from "./operations-planner";

export type AIOperationsRuntimeTelemetry = Readonly<{
  latencyMs: number;
  toolRounds: 0 | 1;
  usage: AIChatCompletionResult["usage"];
}>;

type ExecuteTool = (
  context: Awaited<ReturnType<typeof createManagerAIDataContext>>,
  name: OperationsToolName,
  args: unknown,
) => Promise<ExecutedOperationsTool>;

export type AIOperationsRuntimeDependencies = Readonly<{
  now?: () => Date;
  resolveProvider?: (
    task: "OPERATIONS_QUERY",
  ) => Promise<AIProviderConnectionConfig>;
  planner?: typeof planOperationsRequest;
  plannerDependencies?: OperationsPlannerDependencies;
  createContext?: typeof createManagerAIDataContext;
  executeTool?: ExecuteTool;
  onTelemetry?: (telemetry: AIOperationsRuntimeTelemetry) => void;
}>;

const unsupportedBoundaryPattern =
  /\b(?:drop|truncate|delete\s+all|insert\s+into|update\s+\w+\s+set|select\s+\*|raw\s+database|entire\s+database|execute\s+sql|weather|stock\s+price)\b/i;

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function providerError(error: AIConfigError): AIOperationsError {
  const retryable =
    error.code === "AI_RATE_LIMITED" ||
    error.code === "AI_TIMEOUT" ||
    error.code === "AI_PROVIDER_UNAVAILABLE";
  if (
    error.code === "AI_AUTH_FAILED" ||
    error.code === "AI_RATE_LIMITED" ||
    error.code === "AI_TIMEOUT" ||
    error.code === "AI_PROVIDER_UNAVAILABLE" ||
    error.code === "AI_INVALID_RESPONSE" ||
    error.code === "AI_CAPABILITY_MISMATCH" ||
    error.code === "AI_NOT_CONFIGURED"
  ) {
    return new AIOperationsError(
      error.code,
      AI_OPERATIONS_MESSAGES[error.code],
      error.status === 404 ? 503 : error.status,
      retryable,
      error.code === "AI_NOT_CONFIGURED" ||
        error.code === "AI_AUTH_FAILED" ||
        error.code === "AI_CAPABILITY_MISMATCH"
        ? "CONTACT_ADMIN"
        : "RETRY",
      { cause: error },
    );
  }
  return new AIOperationsError(
    "AI_NOT_CONFIGURED",
    AI_OPERATIONS_MESSAGES.AI_NOT_CONFIGURED,
    503,
    false,
    "CONTACT_ADMIN",
    { cause: error },
  );
}

function invalidProviderOutput(error: unknown): AIOperationsError {
  return new AIOperationsError(
    "AI_INVALID_RESPONSE",
    AI_OPERATIONS_MESSAGES.AI_INVALID_RESPONSE,
    502,
    true,
    "RETRY",
    { cause: error },
  );
}

function toolFreeResponse(
  outcome: "UNSUPPORTED" | "CLARIFICATION",
  now: () => Date,
  context: AIOperationsRequest["context"] = null,
): AIOperationsResponse {
  return aiOperationsResponseSchema.parse({
    outcome,
    answer:
      outcome === "UNSUPPORTED"
        ? "I can help with SejukOps job status and completion records, technician performance, operational totals, and active workload. I cannot browse the database, execute SQL, change records, or answer unrelated questions."
        : "Please specify a supported period, technician, service type, or order number so I can retrieve the correct current data.",
    context: context ?? null,
    toolCalls: [],
    facts: [],
    presentation: null,
    metadata: {
      grounded: true,
      timezone: "Asia/Kuala_Lumpur",
      generatedAt: nowIso(now),
    },
  });
}

/**
 * Executes at most one model planning round and one approved database tool.
 * Tool results, not conversation history or model prose, determine every fact
 * and every structured presentation row in the returned answer.
 */
export async function runAIOperations(
  rawRequest: AIOperationsRequest,
  dependencies: AIOperationsRuntimeDependencies = {},
): Promise<AIOperationsResponse> {
  const request = aiOperationsRequestSchema.parse(rawRequest);
  const now = dependencies.now ?? (() => new Date());
  // Reject explicit boundary attempts before spending provider tokens. This is
  // quality hardening only; the absence of any generic SQL tool is the security boundary.
  if (unsupportedBoundaryPattern.test(request.question)) {
    return toolFreeResponse("UNSUPPORTED", now);
  }

  const context = await (dependencies.createContext ?? createManagerAIDataContext)();
  let provider: AIProviderConnectionConfig;
  try {
    provider = await (
      dependencies.resolveProvider ??
      ((task) => resolveAIProviderForTask(task))
    )("OPERATIONS_QUERY");
  } catch (error) {
    if (error instanceof AIConfigError) throw providerError(error);
    throw error;
  }

  const startedAt = performance.now();
  let planning: Awaited<ReturnType<typeof planOperationsRequest>>;
  try {
    planning = await (dependencies.planner ?? planOperationsRequest)(
      provider,
      request,
      dependencies.plannerDependencies,
    );
  } catch (error) {
    if (error instanceof AIConfigError) throw providerError(error);
    if (error instanceof AIOperationsError) throw error;
    throw invalidProviderOutput(error);
  }

  if (planning.plan.outcome !== "TOOL") {
    dependencies.onTelemetry?.({
      latencyMs: performance.now() - startedAt,
      toolRounds: 0,
      usage: planning.completion.usage,
    });
    return toolFreeResponse(
      planning.plan.outcome,
      now,
      planning.plan.outcome === "CLARIFICATION"
        ? request.context ?? null
        : null,
    );
  }

  let execution: ExecutedOperationsTool;
  try {
    execution = await (dependencies.executeTool ?? executeOperationsTool)(
      context,
      planning.plan.toolName,
      planning.plan.arguments,
    );
  } catch (error) {
    if (error instanceof AIOperationsError) throw error;
    if (error instanceof ZodError) throw invalidProviderOutput(error);
    throw new AIOperationsError(
      "AI_TOOL_FAILED",
      AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
      503,
      true,
      "USE_OPERATIONS_SCREENS",
      { cause: error },
    );
  }

  const facts = buildOperationsFacts(execution);
  const answer = formatGroundedOperationsAnswer(execution);
  try {
    assertGroundedOperationsAnswer(answer, facts);
  } catch (error) {
    throw invalidProviderOutput(error);
  }
  const response = aiOperationsResponseSchema.parse({
    outcome: execution.resultCount === 0 ? "NO_DATA" : "ANSWER",
    answer,
    context: contextFromExecution(execution),
    toolCalls: [
      {
        name: execution.name,
        arguments: execution.arguments,
        resultCount: execution.resultCount,
      },
    ],
    facts,
    presentation:
      execution.resultCount === 0 ? null : buildOperationsPresentation(execution),
    metadata: {
      grounded: true,
      timezone: "Asia/Kuala_Lumpur",
      generatedAt: nowIso(now),
    },
  });
  dependencies.onTelemetry?.({
    latencyMs: performance.now() - startedAt,
    toolRounds: 1,
    usage: planning.completion.usage,
  });
  return response;
}
