import { aiObservationRecordSchema, type AIObservationRecord } from "@/domain/ai-observability/contracts";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { PROVIDER_FAILURE_CATEGORIES } from "./safe-provider-exchange-metadata";
import { KNOWLEDGE_FAILURE_STAGES } from "@/lib/ai/runtime/workspace-knowledge-diagnostics";

type Outcome = "SUCCEEDED" | "CONTROLLED" | "FAILED";
type ErrorCode = "GUEST_AI_EXHAUSTED" | "GUEST_AI_UNAVAILABLE" |
  "ORDER_ACCESS_DENIED" | "WORKSPACE_AGENT_UNAVAILABLE" | "WORKSPACE_AGENT_ERROR" |
  "KNOWLEDGE_ACCESS_DENIED" | "KNOWLEDGE_AGENT_UNAVAILABLE" | "KNOWLEDGE_AGENT_ERROR" |
  "INTAKE_ACCESS_DENIED" | "INTAKE_UNAVAILABLE" | "INTAKE_STALE" | null;

function boundedCount(value: number | undefined, limit: number): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, limit) : null;
}

/** Whitelist metadata only. The question, tool rows, model payloads, and secrets are never inputs. */
export function buildWorkspaceAIRecord(input: Readonly<{
  task: "WORKSPACE_ORDERS" | "WORKSPACE_KNOWLEDGE" | "DOCUMENT_UNDERSTANDING";
  traceId: string;
  actor: ActorContext;
  workspaceId: string;
  guestVisitId: string | null;
  demoGeneration: number | null;
  status: Outcome;
  errorCode: ErrorCode;
  durationMs: number;
  providerSteps?: number;
  inputTokens?: number;
  outputTokens?: number;
  diagnostics?: { finalFinishReason?: string; visibleTextLength?: number; reasoningTokens?: number; providerStatusCode?: number; upstreamErrorCode?: number; providerFailureCategory?: string | null;
    failureStage?: string; toolAttempts?: number; searchCompleted?: number; invalidToolCalls?: number; toolErrors?: number };
}>): AIObservationRecord {
  return aiObservationRecordSchema.parse({
    id: crypto.randomUUID(), traceId: input.traceId, createdAt: new Date().toISOString(),
    task: input.task,
    actorRole: input.actor.platformRole === "SUPER_ADMIN"
      ? "SUPER_ADMIN" : input.actor.membership?.role,
    status: input.status,
    durationMs: Math.max(0, Math.min(120_000, Math.round(input.durationMs))),
    execution: {
      flow: input.task === "WORKSPACE_ORDERS"
        ? "Bounded workspace orders agent" : input.task === "WORKSPACE_KNOWLEDGE"
          ? "Bounded workspace knowledge agent" : "Document extraction to editable draft; explicit confirmation required",
      workspaceId: input.workspaceId,
      workspaceKind: input.actor.membership?.kind ?? null,
      workspaceRole: input.actor.membership?.role ?? null,
      guestVisitId: input.guestVisitId,
      demoGeneration: input.demoGeneration,
      providerSteps: boundedCount(input.providerSteps, 2) ?? 0,
      inputTokens: boundedCount(input.inputTokens, 1_000_000),
      outputTokens: boundedCount(input.outputTokens, 1_000_000),
      finalFinishReason: ["stop", "length", "tool-calls", "content-filter", "error", "other", "unknown"]
        .includes(input.diagnostics?.finalFinishReason ?? "") ? input.diagnostics!.finalFinishReason : null,
      visibleTextLength: boundedCount(input.diagnostics?.visibleTextLength, 10_000),
      reasoningTokens: boundedCount(input.diagnostics?.reasoningTokens, 1_000_000),
      providerStatusCode: input.diagnostics?.providerStatusCode !== undefined &&
        Number.isInteger(input.diagnostics.providerStatusCode) && input.diagnostics.providerStatusCode >= 0 &&
        input.diagnostics.providerStatusCode <= 599 ? input.diagnostics.providerStatusCode : null,
      upstreamErrorCode: typeof input.diagnostics?.upstreamErrorCode === "number" &&
        Number.isSafeInteger(input.diagnostics.upstreamErrorCode) ? input.diagnostics.upstreamErrorCode : null,
      providerFailureCategory: PROVIDER_FAILURE_CATEGORIES.find((category) => category === input.diagnostics?.providerFailureCategory) ?? null,
      ...(input.task === "WORKSPACE_KNOWLEDGE" ? {
        failureStage: KNOWLEDGE_FAILURE_STAGES.find((stage) => stage === input.diagnostics?.failureStage) ?? null,
        toolAttempts: boundedCount(input.diagnostics?.toolAttempts, 8),
        searchCompleted: boundedCount(input.diagnostics?.searchCompleted, 1),
        invalidToolCalls: boundedCount(input.diagnostics?.invalidToolCalls, 8),
        toolErrors: boundedCount(input.diagnostics?.toolErrors, 8),
      } : {}),
    },
    providerCalls: [], errorCode: input.errorCode,
    safety: {
      rawPromptPersisted: false, rawProviderResponsePersisted: false,
      sanitizedDebugPayloadPersisted: false, credentialsPersisted: false,
      documentFieldValuesPersisted: false,
    },
  });
}
