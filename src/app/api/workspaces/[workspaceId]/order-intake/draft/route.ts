import { NextResponse } from "next/server";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { readGuestAiBudget, reserveGuestAiCall } from "@/lib/ai/runtime/guest-ai-budget";
import { prepareWorkspaceOrderDraft, WorkspaceOrderIntakeError } from "@/lib/services/workspace-order-intake/draft";

export const runtime = "nodejs";
export const maxDuration = 45;
const MAX_BODY_BYTES = 5 * 1024 * 1024 + 16 * 1024;
type RouteContext = { params: Promise<{ workspaceId: string }> };

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

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { workspaceId } = await context.params;
  try {
    const workspaceContext = await getWorkspaceRequestContext(workspaceId);
    if (!workspaceContext) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { actor, client: supabase, guestVisit } = workspaceContext;
    if (actor.membership?.workspaceId !== workspaceId ||
        actor.membership.role !== "ADMIN" ||
        !hasActorPermission(actor, "order:create") || !hasActorPermission(actor, "ai:use")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const form = await boundedFormData(request);
    const file = form.get("file");
    if (!(file instanceof Blob) ||
        (file.type !== "text/plain" && file.type !== "application/pdf") ||
        file.size < 1 || file.size > (file.type === "text/plain" ? 2 : 5) * 1024 * 1024) {
      return NextResponse.json({ error: "Invalid document" }, { status: 400 });
    }
    if (guestVisit) {
      const budget = await readGuestAiBudget(guestVisit);
      if (!budget) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_UNAVAILABLE");
      if (budget.remaining === 0) {
        throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_EXHAUSTED", budget.resetAt);
      }
    }
    const result = await prepareWorkspaceOrderDraft(actor, supabase, {
      workspaceId, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    }, {
      abortSignal: request.signal,
      beforeProviderCall: guestVisit ? async () => {
        const reservation = await reserveGuestAiCall(guestVisit);
        if (!reservation) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_UNAVAILABLE");
        if (!reservation.allowed) throw new WorkspaceOrderIntakeError("AI_ALLOWANCE_EXHAUSTED", reservation.resetAt);
      } : undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderIntakeError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden"
        : error.code === "STALE" ? "Workspace changed; upload again"
          : error.code === "AI_ALLOWANCE_EXHAUSTED" ? "Today's Guest AI allowance is used up. Please return after the Malaysia-time reset."
            : error.code === "AI_ALLOWANCE_UNAVAILABLE" ? "Guest AI is temporarily unavailable. Manual Demo actions still work."
          : error.code === "INVALID_INPUT" ? "Invalid document" : "Extraction unavailable",
        resetAt: error.resetAt ?? null },
      { status: error.code === "FORBIDDEN" ? 403 : error.code === "STALE" ? 409
        : error.code === "AI_ALLOWANCE_EXHAUSTED" ? 429
          : error.code === "INVALID_INPUT" ? 400 : 503 });
    }
    if (error instanceof Error && error.message === "INVALID_BODY") {
      return NextResponse.json({ error: "Invalid document" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return NextResponse.json({ error: "Document too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Extraction unavailable" }, { status: 503 });
  }
}
