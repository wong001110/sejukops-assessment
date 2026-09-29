import { aiObservationRecordSchema, type AIObservationRecord } from "@/domain/ai-observability/contracts";
import type { ActorContext } from "@/lib/auth/actor-policy";

type Outcome = "SUCCEEDED" | "CONTROLLED" | "FAILED";
type ErrorCode = "GUEST_AI_EXHAUSTED" | "GUEST_AI_UNAVAILABLE" |
  "ORDER_ACCESS_DENIED" | "WORKSPACE_AGENT_UNAVAILABLE" | "WORKSPACE_AGENT_ERROR" | null;

function boundedCount(value: number | undefined, limit: number): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, limit) : null;
}

/** Whitelist metadata only. The question, tool rows, model payloads, and secrets are never inputs. */
export function buildWorkspaceAIRecord(input: Readonly<{
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
}>): AIObservationRecord {
  return aiObservationRecordSchema.parse({
    id: crypto.randomUUID(), traceId: input.traceId, createdAt: new Date().toISOString(),
    task: "WORKSPACE_ORDERS",
    actorRole: input.actor.platformRole === "SUPER_ADMIN"
      ? "SUPER_ADMIN" : input.actor.membership?.role,
    status: input.status,
    durationMs: Math.max(0, Math.min(120_000, Math.round(input.durationMs))),
    execution: {
      flow: "Bounded workspace orders agent",
      workspaceId: input.workspaceId,
      workspaceKind: input.actor.membership?.kind ?? null,
      workspaceRole: input.actor.membership?.role ?? null,
      guestVisitId: input.guestVisitId,
      demoGeneration: input.demoGeneration,
      providerSteps: boundedCount(input.providerSteps, 2) ?? 0,
      inputTokens: boundedCount(input.inputTokens, 1_000_000),
      outputTokens: boundedCount(input.outputTokens, 1_000_000),
    },
    providerCalls: [], errorCode: input.errorCode,
    safety: {
      rawPromptPersisted: false, rawProviderResponsePersisted: false,
      sanitizedDebugPayloadPersisted: false, credentialsPersisted: false,
      documentFieldValuesPersisted: false,
    },
  });
}
