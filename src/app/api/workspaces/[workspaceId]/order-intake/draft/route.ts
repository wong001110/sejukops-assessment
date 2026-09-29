import { NextResponse } from "next/server";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { reserveDemoAiCall } from "@/lib/ai/runtime/demo-ai-budget";
import { prepareWorkspaceOrderDraft, WorkspaceOrderIntakeError } from "@/lib/services/workspace-order-intake/draft";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
    const actor = await getServerActorContext(workspaceId);
    if (!actor || actor.membership?.workspaceId !== workspaceId ||
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
    if (actor.membership.kind === "DEMO" &&
        !await reserveDemoAiCall(actor, workspaceId, request.headers)) {
      return NextResponse.json({ error: "Demo AI limit reached or unavailable" }, { status: 429 });
    }
    const supabase = await createServerSupabaseClient();
    const result = await prepareWorkspaceOrderDraft(actor, supabase, {
      workspaceId, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceOrderIntakeError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden"
        : error.code === "STALE" ? "Workspace changed; upload again"
          : error.code === "INVALID_INPUT" ? "Invalid document" : "Extraction unavailable" },
      { status: error.code === "FORBIDDEN" ? 403 : error.code === "STALE" ? 409
        : error.code === "INVALID_INPUT" ? 400 : 503 });
    }
    return NextResponse.json({ error: "Invalid document" }, { status: 400 });
  }
}
