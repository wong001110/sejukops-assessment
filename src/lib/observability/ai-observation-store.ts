import "server-only";

import {
  aiObservationListResponseSchema,
  aiObservationRecordSchema,
  type AIObservationListResponse,
  type AIObservationRecord,
  type AIObservationTask,
  type AIProviderCallSummary,
  type AIProviderDebugSnapshot,
} from "@/domain/ai-observability/contracts";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

import type { AIProviderExchange } from "./ai-provider-observation-server";

export const AI_OBSERVATION_EVENT_TYPE = "AI_OBSERVATION";
export const AI_OBSERVATION_RETENTION_DAYS = 7 as const;
const MAX_OBSERVATIONS = 100;

const SAFETY: AIObservationRecord["safety"] = {
  rawPromptPersisted: false,
  rawProviderResponsePersisted: false,
  sanitizedDebugPayloadPersisted: true,
  credentialsPersisted: false,
  documentFieldValuesPersisted: false,
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown): number | null {
  const numeric = numberValue(value);
  return numeric !== null && Number.isInteger(numeric) && numeric >= 0
    ? numeric
    : null;
}

function endpointLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.slice(0, 2048);
  }
}

function tokenUsage(value: unknown): AIProviderCallSummary["usage"] {
  const body = record(value);
  const usage = record(body?.usage);
  if (!usage) return null;
  const promptTokens = integerValue(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens,
  );
  const completionTokens = integerValue(
    usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens,
  );
  const totalTokens = integerValue(usage.total_tokens ?? usage.totalTokens);
  if (
    promptTokens === null &&
    completionTokens === null &&
    totalTokens === null
  ) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function systemPromptFromBody(value: unknown): string | null {
  const body = record(value);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const value of messages) {
    const message = record(value);
    if (stringValue(message?.role) !== "system") continue;
    const content = message?.content;
    if (typeof content === "string") return content.slice(0, 32_000);
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          const object = record(part);
          return stringValue(object?.type) === "text"
            ? stringValue(object?.text) ?? ""
            : "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) return text.slice(0, 32_000);
    }
  }
  return null;
}

function documentSafeRequest(value: unknown): unknown {
  const body = record(value);
  if (!body) return null;
  const messages = Array.isArray(body.messages)
    ? body.messages.map((value) => {
        const message = record(value);
        const role = stringValue(message?.role) ?? "unknown";
        return role === "system"
          ? { role, content: message?.content ?? null }
          : { role, content: "[document/user payload omitted]" };
      })
    : [];
  return {
    model: body.model ?? null,
    messages,
    max_tokens: body.max_tokens ?? null,
    temperature: body.temperature ?? null,
    response_format: body.response_format ?? null,
  };
}

function debugSnapshot(
  exchange: AIProviderExchange,
  task: AIObservationTask,
): AIProviderDebugSnapshot {
  const documentPayloadOmitted = task === "DOCUMENT_UNDERSTANDING";
  return {
    systemPrompt: systemPromptFromBody(exchange.request.body),
    requestBody: documentPayloadOmitted
      ? documentSafeRequest(exchange.request.body)
      : exchange.request.body ?? null,
    responseBody: documentPayloadOmitted
      ? "[document extraction response omitted]"
      : exchange.response.body ?? null,
    documentPayloadOmitted,
  };
}

function summarizeProviderCalls(
  exchanges: readonly AIProviderExchange[],
  task: AIObservationTask,
): readonly AIProviderCallSummary[] {
  return exchanges.slice(0, 8).map((exchange) => ({
    sequence: exchange.sequence,
    providerType: exchange.providerType,
    providerSource: exchange.providerSource ?? null,
    endpoint: endpointLabel(exchange.endpoint),
    model: exchange.model,
    statusCode: exchange.statusCode,
    statusText: exchange.statusText.slice(0, 160),
    durationMs: Math.max(0, Math.round(exchange.durationMs)),
    usage: tokenUsage(exchange.response.body),
    errorName: exchange.error?.name?.slice(0, 120) ?? null,
    debug: debugSnapshot(exchange, task),
  }));
}

function operationsExecution(
  result: JsonRecord,
  providerCallCount: number,
): JsonRecord {
  const metadata = record(result.metadata);
  const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
  const toolCall = record(toolCalls[0]);
  const args = record(toolCall?.arguments);
  const toolExecuted = Boolean(toolCall);
  return {
    flow: toolExecuted
      ? "LLM planner → approved operations tool → structured data → deterministic grounded formatter"
      : providerCallCount > 0
        ? "LLM planner → controlled no-tool outcome"
        : "Deterministic request boundary → controlled no-tool outcome",
    providerRole: providerCallCount > 0 ? "REQUEST_PLANNER" : "NOT_CALLED",
    answerGeneration: toolExecuted
      ? "DETERMINISTIC_FROM_TOOL_RESULT"
      : "CONTROLLED_NO_TOOL_RESPONSE",
    outcome: stringValue(result.outcome),
    noToolExpected:
      !toolExecuted &&
      ["UNSUPPORTED", "CLARIFICATION"].includes(stringValue(result.outcome) ?? ""),
    grounded: metadata?.grounded === true,
    factCount: Array.isArray(result.facts) ? result.facts.length : 0,
    tool: toolCall
      ? {
          name: stringValue(toolCall.name),
          resultCount: integerValue(toolCall.resultCount),
          period: stringValue(args?.period),
          completedOnly: args?.completedOnly === true,
          hasTechnicianFilter: Boolean(stringValue(args?.technicianName)),
          hasStatusFilter: Boolean(stringValue(args?.status)),
          hasServiceTypeFilter: Boolean(stringValue(args?.serviceType)),
          hasOrderNumberFilter: Boolean(stringValue(args?.orderNumber)),
          limit: integerValue(args?.limit),
        }
      : null,
  };
}

function insightExecution(
  result: JsonRecord,
  providerCallCount: number,
): JsonRecord {
  const metadata = record(result.metadata);
  const cached = result.cached === true;
  return {
    flow: cached
      ? "Dashboard metrics version → validated cached insight"
      : providerCallCount > 0
        ? "Dashboard aggregate → deterministic facts → LLM interpretation → citation validation"
        : "Dashboard aggregate → deterministic facts → no provider result",
    providerRole: cached
      ? "NOT_CALLED_CACHE_HIT"
      : providerCallCount > 0
        ? "GROUNDED_INTERPRETER"
        : "NOT_CALLED",
    period: stringValue(result.period),
    cached,
    grounded: metadata?.grounded === true,
    factCount: Array.isArray(result.facts) ? result.facts.length : 0,
    citationCount: Array.isArray(result.citations) ? result.citations.length : 0,
  };
}

function workflowExecution(
  result: JsonRecord,
  providerCallCount: number,
): JsonRecord {
  const flag = record(result.flag);
  const explanation = record(flag?.explanation);
  const replayed = result.replayed === true;
  return {
    flow:
      replayed && providerCallCount === 0
        ? "Stored deterministic flag/explanation replay → human review"
        : providerCallCount > 0
          ? "Deterministic workflow flag → LLM explanation → fact citation validation → human review"
          : "Deterministic workflow flag → no provider explanation → human review",
    providerRole:
      replayed && providerCallCount === 0
        ? "NOT_CALLED_REPLAY"
        : providerCallCount > 0
          ? "FLAG_EXPLAINER"
          : "NOT_CALLED",
    ruleCode: stringValue(flag?.ruleCode),
    severity: stringValue(flag?.severity),
    flagStatus: stringValue(flag?.status),
    explanationStatus: stringValue(explanation?.status),
    replayed,
  };
}

function documentExecution(
  result: JsonRecord,
  providerCallCount: number,
): JsonRecord {
  const documentImport = record(result.documentImport);
  const draft = record(documentImport?.draft);
  const confidence: Record<string, string | null> = {};
  for (const key of [
    "customerName",
    "serviceType",
    "serviceDetails",
    "amount",
    "date",
  ]) {
    confidence[key] = stringValue(record(draft?.[key])?.confidence);
  }
  const failure = record(documentImport?.failure);
  return {
    flow:
      providerCallCount > 0
        ? "Private source → text/image model input → schema validation → review draft → explicit human confirmation"
        : "Private source / validation boundary → no model call → reviewable outcome",
    providerRole:
      providerCallCount > 0 ? "STRUCTURED_EXTRACTOR" : "NOT_CALLED",
    mimeType: stringValue(documentImport?.mimeType),
    extractionStatus: stringValue(documentImport?.extractionStatus),
    extractionAttemptCount: integerValue(documentImport?.extractionAttemptCount),
    fieldConfidence: confidence,
    failureCode: stringValue(failure?.code),
    humanConfirmationRequired: true,
  };
}

function providerTestExecution(
  result: JsonRecord,
  providerCallCount: number,
): JsonRecord {
  return {
    flow:
      providerCallCount > 0
        ? "Admin provider configuration → isolated connection test → provider response validation"
        : "Admin provider configuration → preflight validation → no provider call",
    providerRole:
      providerCallCount > 0 ? "CONNECTIVITY_TEST" : "NOT_CALLED",
    connectionOk: result.ok === true,
  };
}

function summarizeExecution(
  task: AIObservationTask,
  value: unknown,
  providerCallCount: number,
): JsonRecord {
  const result = record(value) ?? {};
  if (task === "OPERATIONS_QUERY") {
    return operationsExecution(result, providerCallCount);
  }
  if (task === "OPERATIONAL_INSIGHT") {
    return insightExecution(result, providerCallCount);
  }
  if (task === "WORKFLOW_EXPLANATION") {
    return workflowExecution(result, providerCallCount);
  }
  if (task === "DOCUMENT_UNDERSTANDING") {
    return documentExecution(result, providerCallCount);
  }
  return providerTestExecution(result, providerCallCount);
}

function semanticFailureCode(
  task: AIObservationTask,
  value: unknown,
): string | null {
  const result = record(value);
  if (!result) return null;

  if (task === "WORKFLOW_EXPLANATION") {
    const explanation = record(record(result.flag)?.explanation);
    if (stringValue(explanation?.status) === "UNAVAILABLE") {
      return (
        stringValue(explanation?.errorCode) ??
        "WORKFLOW_EXPLANATION_UNAVAILABLE"
      );
    }
  }

  if (task === "DOCUMENT_UNDERSTANDING") {
    const documentImport = record(result.documentImport);
    if (stringValue(documentImport?.extractionStatus) === "FAILED") {
      return (
        stringValue(record(documentImport?.failure)?.code) ??
        "DOCUMENT_EXTRACTION_FAILED"
      );
    }
  }

  if (task === "PROVIDER_TEST" && result.ok === false) {
    return "PROVIDER_TEST_FAILED";
  }

  return null;
}

function controlledOutcome(task: AIObservationTask, value: unknown): boolean {
  if (task !== "OPERATIONS_QUERY") return false;
  const outcome = stringValue(record(value)?.outcome);
  return outcome === "UNSUPPORTED" || outcome === "CLARIFICATION";
}

function safeErrorCode(error: unknown, responseStatus: number): string | null {
  const object = record(error);
  const code = stringValue(object?.code);
  if (code) return code.slice(0, 120);
  if (error instanceof Error && error.name && error.name !== "Error") {
    return error.name.slice(0, 120);
  }
  return responseStatus >= 400 ? `HTTP_${responseStatus}` : null;
}

export async function persistAIObservation(input: Readonly<{
  traceId: string;
  task: AIObservationTask;
  ok: boolean;
  value?: unknown;
  error?: unknown;
  responseStatus: number;
  durationMs: number;
  exchanges: readonly AIProviderExchange[];
}>): Promise<void> {
  try {
    const context = await createAuthorizedDataContext("ai:use");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const semanticError = input.ok
      ? semanticFailureCode(input.task, input.value)
      : null;
    const providerCalls = summarizeProviderCalls(input.exchanges, input.task);
    const status = !input.ok || semanticError !== null
      ? "FAILED"
      : controlledOutcome(input.task, input.value)
        ? "CONTROLLED"
        : "SUCCEEDED";
    const observation = aiObservationRecordSchema.parse({
      id,
      traceId: input.traceId,
      createdAt,
      task: input.task,
      actorRole: context.identity.role,
      status,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      execution: input.ok
        ? summarizeExecution(input.task, input.value, providerCalls.length)
        : {},
      providerCalls,
      errorCode: input.ok
        ? semanticError
        : safeErrorCode(input.error, input.responseStatus),
      safety: SAFETY,
    });

    const { error } = await context.supabase.from("audit_logs").insert({
      id,
      order_id: null,
      actor_profile_id: context.identity.profileId,
      event_type: AI_OBSERVATION_EVENT_TYPE,
      idempotency_key: `ai-observation:${input.traceId}`,
      metadata_json: observation,
      created_at: createdAt,
    });
    if (error) return;

    const cutoff = new Date(
      Date.now() - AI_OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    await context.supabase
      .from("audit_logs")
      .delete()
      .eq("event_type", AI_OBSERVATION_EVENT_TYPE)
      .lt("created_at", cutoff);
  } catch {
    // Observability is best-effort and must never become a dependency of an AI workflow.
  }
}

export async function listAIObservations(): Promise<AIObservationListResponse> {
  const context = await createAuthorizedDataContext("diagnostics:view");
  const { data, error } = await context.supabase
    .from("audit_logs")
    .select("metadata_json")
    .eq("event_type", AI_OBSERVATION_EVENT_TYPE)
    .order("created_at", { ascending: false })
    .limit(MAX_OBSERVATIONS);
  if (error) throw error;

  const observations: AIObservationRecord[] = [];
  for (const row of data ?? []) {
    const parsed = aiObservationRecordSchema.safeParse(row.metadata_json);
    if (parsed.success) observations.push(parsed.data);
  }

  return aiObservationListResponseSchema.parse({
    retentionDays: AI_OBSERVATION_RETENTION_DAYS,
    observations,
  });
}
