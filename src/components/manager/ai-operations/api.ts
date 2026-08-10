import {
  aiOperationsErrorEnvelopeSchema,
  aiOperationsResponseSchema,
  operationalInsightResponseSchema,
  type AIOperationsErrorEnvelope,
  type AIOperationsRequest,
  type AIOperationsResponse,
  type OperationalInsightRequest,
  type OperationalInsightResponse,
} from "@/domain/ai-operations/contracts";

export class AIOperationsClientError extends Error {
  constructor(readonly details: AIOperationsErrorEnvelope["error"]) {
    super(details.message);
    this.name = "AIOperationsClientError";
  }
}

export function aiRecoveryCopy(action: AIOperationsErrorEnvelope["error"]["action"]) {
  if (action === "CONTACT_ADMIN") return "Ask an Admin to check the AI configuration and run Test Connection.";
  if (action === "USE_OPERATIONS_SCREENS") return "Use the normal Dashboard and review screens while this data request is unavailable.";
  if (action === "REFRESH_DASHBOARD") return "Refresh the Dashboard metrics, then try the insight again.";
  return "Retry when the connection is available. Your operational data has not changed.";
}

async function parseResponse<T>(response: Response, parse: (input: unknown) => T): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = aiOperationsErrorEnvelopeSchema.safeParse(body);
    throw new AIOperationsClientError(parsed.success
      ? parsed.data.error
      : { code: "AI_PROVIDER_UNAVAILABLE", message: "The AI request could not be completed. Please retry.", retryable: true, action: "RETRY" });
  }
  return parse(body);
}

export async function askAIOperations(input: AIOperationsRequest, signal?: AbortSignal): Promise<AIOperationsResponse> {
  const response = await fetch("/api/manager/ai-operations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return parseResponse(response, (body) => aiOperationsResponseSchema.parse(body));
}

export async function fetchOperationalInsight(input: OperationalInsightRequest, signal?: AbortSignal): Promise<OperationalInsightResponse> {
  const response = await fetch("/api/manager/operational-insight", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return parseResponse(response, (body) => operationalInsightResponseSchema.parse(body));
}
