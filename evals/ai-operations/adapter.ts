import {
  aiOperationsErrorCodeSchema,
  aiOperationsResponseSchema,
  type AIOperationsResponse,
} from "@/domain/ai-operations/contracts";

import type { OperationsEvalObservation } from "./types";

export function observeRuntimeResponse(
  input: AIOperationsResponse,
): OperationsEvalObservation {
  const response = aiOperationsResponseSchema.parse(input);
  return {
    outcome: response.outcome,
    toolCalls: response.toolCalls,
    facts: response.facts.map(({ key, value }) => ({ key, value })),
    context: response.context,
    groundingViolations: response.metadata.grounded
      ? []
      : ["Runtime response was not grounded"],
  };
}

export function observeRuntimeError(error: unknown): OperationsEvalObservation {
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  const parsed = aiOperationsErrorCodeSchema.safeParse(candidate);

  return {
    outcome: "ERROR",
    toolCalls: [],
    facts: [],
    errorCode: parsed.success ? parsed.data : "AI_INVALID_RESPONSE",
  };
}
