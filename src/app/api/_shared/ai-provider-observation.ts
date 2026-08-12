import { NextResponse } from "next/server";

import { persistAIObservation } from "@/lib/observability/ai-observation-store";
import {
  runWithAIProviderObservation,
  type AIProviderObservationTask,
} from "@/lib/observability/ai-provider-observation-server";

/**
 * Wraps a supported AI route with always-on, server-owned observation. The
 * browser receives only the normal feature payload plus a trace ID header;
 * raw provider request/response bodies never travel in a debug envelope.
 */
export async function observedAIJson<T>(
  request: Request,
  task: AIProviderObservationTask,
  action: () => Promise<T>,
  onError: (error: unknown) => NextResponse,
) {
  const startedAt = Date.now();
  const observed = await runWithAIProviderObservation(request, task, action);
  const response = observed.ok
    ? NextResponse.json(observed.value)
    : onError(observed.error);

  await persistAIObservation({
    traceId: observed.traceId,
    task,
    ok: observed.ok,
    value: observed.ok ? observed.value : undefined,
    error: observed.ok ? undefined : observed.error,
    responseStatus: response.status,
    durationMs: Date.now() - startedAt,
    exchanges: observed.exchanges,
  });

  response.headers.set("x-sejuk-trace-id", observed.traceId);
  return response;
}
