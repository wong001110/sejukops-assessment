import { NextResponse } from "next/server";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import {
  runWithAIProviderObservation,
  type AIProviderExchange,
} from "@/lib/observability/ai-provider-observation-server";
import { safeProviderExchangeMetadata } from "@/lib/observability/safe-provider-exchange-metadata";
import { buildWorkspaceAIRecord } from "@/lib/observability/workspace-ai-record";
import { persistWorkspaceAIRecord } from "@/lib/observability/workspace-ai-store";
import { prepareWorkspaceOrderDraft, WorkspaceOrderIntakeError } from "@/lib/services/workspace-order-intake/draft";

export const runtime = "nodejs";
export const maxDuration = 45;
const MAX_BODY_BYTES = 5 * 1024 * 1024 + 16 * 1024;
type RouteContext = { params: Promise<{ workspaceId: string }> };
type Scope = { actor: ActorContext; guestVisitId: string | null; demoGeneration: number | null };

type Failure = {
  status: number;
  observationStatus: "CONTROLLED" | "FAILED";
  errorCode: Parameters<typeof buildWorkspaceAIRecord>[0]["errorCode"];
  message: string;
  resetAt?: string;
};

async function boundedFormData(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data; boundary=") || !request.body) throw new Error("INVALID_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  return new Request(request.url, { method: "POST", headers: { "Content-Type": type }, body }).formData();
}

function failureFor(error: unknown): Failure {
  if (error instanceof WorkspaceOrderIntakeError) {
    switch (error.code) {
      case "FORBIDDEN":
        return { status: 403, observationStatus: "FAILED", errorCode: "INTAKE_ACCESS_DENIED", message: "Forbidden" };
      case "INVALID_INPUT":
        return { status: 400, observationStatus: "CONTROLLED", errorCode: null, message: "Invalid document" };
      case "STALE":
        return { status: 409, observationStatus: "CONTROLLED", errorCode: "INTAKE_STALE", message: "Workspace changed; upload again" };
      case "AI_ALLOWANCE_EXHAUSTED":
        return { status: 429, observationStatus: "CONTROLLED", errorCode: "GUEST_AI_EXHAUSTED", message: "Today's Guest AI allowance is used up. Please return after the Malaysia-time reset.", resetAt: error.resetAt };
      case "AI_ALLOWANCE_UNAVAILABLE":
        return { status: 503, observationStatus: "FAILED", errorCode: "GUEST_AI_UNAVAILABLE", message: "Guest AI is temporarily unavailable. Manual Demo actions still work." };
      default:
        return { status: 503, observationStatus: "FAILED", errorCode: "INTAKE_UNAVAILABLE", message: "Extraction unavailable" };
    }
  }
  if (error instanceof Error && error.message === "INVALID_BODY") {
    return { status: 400, observationStatus: "CONTROLLED", errorCode: null, message: "Invalid document" };
  }
  if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
    return { status: 413, observationStatus: "CONTROLLED", errorCode: null, message: "Document too large" };
  }
  return { status: 503, observationStatus: "FAILED", errorCode: "INTAKE_UNAVAILABLE", message: "Extraction unavailable" };
}

async function persistObservation(input: {
  scope: Scope;
  workspaceId: string;
  traceId: string;
  startedAt: number;
  status: "SUCCEEDED" | "CONTROLLED" | "FAILED";
  errorCode: Failure["errorCode"];
  exchanges: readonly AIProviderExchange[];
}) {
  const { scope, workspaceId, traceId, startedAt, status, errorCode, exchanges } = input;
  const metadata = safeProviderExchangeMetadata(exchanges);
  try {
    await persistWorkspaceAIRecord(buildWorkspaceAIRecord({
      task: "DOCUMENT_UNDERSTANDING",
      traceId,
      actor: scope.actor,
      workspaceId,
      guestVisitId: scope.guestVisitId,
      demoGeneration: scope.demoGeneration,
      status,
      errorCode,
      durationMs: performance.now() - startedAt,
      providerSteps: metadata.providerSteps,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      diagnostics: metadata.diagnostics,
    }), scope.actor.profileId);
  } catch {
    // Observation failures never change the document review result.
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { workspaceId } = await context.params;
  const startedAt = performance.now();
  let scope: Scope | null = null;

  const observed = await runWithAIProviderObservation(request, "DOCUMENT_UNDERSTANDING", async () => {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) throw new WorkspaceOrderIntakeError("FORBIDDEN");
    const { actor, client: supabase, guestVisit } = workspaceContext;
    if (actor.membership?.workspaceId !== workspaceId || actor.membership.role !== "ADMIN" ||
        !hasActorPermission(actor, "order:create") || !hasActorPermission(actor, "ai:use")) {
      throw new WorkspaceOrderIntakeError("FORBIDDEN");
    }
    scope = { actor, guestVisitId: guestVisit?.id ?? null, demoGeneration: guestVisit?.demoGeneration ?? null };

    const form = await boundedFormData(request);
    const file = form.get("file");
    if (!(file instanceof Blob) ||
        (file.type !== "text/plain" && file.type !== "application/pdf") ||
        file.size < 1 || file.size > (file.type === "text/plain" ? 2 : 5) * 1024 * 1024) {
      throw new WorkspaceOrderIntakeError("INVALID_INPUT");
    }
    if (guestVisit) {
      const budget = await readGuestAiBudget(guestVisit);
      if (!budget) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_UNAVAILABLE");
      if (budget.remaining === 0) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_EXHAUSTED", budget.resetAt);
    }
    return prepareWorkspaceOrderDraft(actor, supabase, {
      workspaceId, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    }, {
      abortSignal: request.signal,
      beforeProviderCall: guestVisit ? async () => {
        const reservation = await reserveGuestAiCall(guestVisit);
        if (!reservation) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_UNAVAILABLE");
        if (!reservation.allowed) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_EXHAUSTED", reservation.resetAt);
      } : undefined,
    });
  });

  const failure = observed.ok ? null : failureFor(observed.error);
  const response = observed.ok
    ? NextResponse.json(observed.value, { headers: { "Cache-Control": "private, no-store" } })
    : NextResponse.json({ error: failure!.message, resetAt: failure!.resetAt ?? null }, { status: failure!.status });

  if (scope) {
    await persistObservation({
      scope,
      workspaceId,
      traceId: observed.traceId,
      startedAt,
      status: observed.ok ? "SUCCEEDED" : failure!.observationStatus,
      errorCode: failure?.errorCode ?? null,
      exchanges: observed.exchanges,
    });
    response.headers.set("x-sejuk-trace-id", observed.traceId);
  }
  return response;
}
