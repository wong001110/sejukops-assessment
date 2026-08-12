import { NextResponse } from "next/server";

import {
  runWithAIProviderObservation,
  type AIProviderObservationTask,
  type AIProviderExchange,
} from "@/lib/observability/ai-provider-observation-server";

const DEBUG_KEY = "__aiProviderObservation";

async function attachObservation(response: NextResponse, exchanges: readonly AIProviderExchange[]) {
  if (!exchanges.length) return response;
  let body: unknown = {};
  try { body = await response.clone().json(); }
  catch { return response; }

  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), [DEBUG_KEY]: { exchanges } }
    : { data: body, [DEBUG_KEY]: { exchanges } };

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return NextResponse.json(payload, { status: response.status, headers });
}

export async function observedAIJson<T>(
  request: Request,
  task: AIProviderObservationTask,
  action: () => Promise<T>,
  onError: (error: unknown) => NextResponse,
) {
  const observed = await runWithAIProviderObservation(request, task, action);
  const response = observed.ok
    ? NextResponse.json(observed.value)
    : onError(observed.error);
  return attachObservation(response, observed.exchanges);
}
