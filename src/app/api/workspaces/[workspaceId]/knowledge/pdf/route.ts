import { NextResponse } from "next/server";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import {
  extractKnowledgePdfPages, preflightKnowledgePdfStage, stageKnowledgePdfText, WorkspaceKnowledgeError,
} from "@/lib/services/workspace-knowledge/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;
const MAX_BODY_BYTES = 5 * 1024 * 1024 + 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type RouteContext = { params: Promise<{ workspaceId: string }> };

async function boundedFormData(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data; boundary=") || !request.body) throw new Error("INVALID_BODY");
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
  return new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body }).formData();
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { workspaceId } = await context.params;
  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (actor.membership?.workspaceId !== workspaceId ||
        !["ADMIN", "MANAGER"].includes(actor.membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const form = await boundedFormData(request);
    const file = form.get("file");
    const documentId = form.get("documentId");
    const generation = Number(form.get("generation"));
    if (!(file instanceof Blob) || file.type !== "application/pdf" || file.size > 5 * 1024 * 1024 ||
        typeof documentId !== "string" || !UUID.test(documentId) ||
        !Number.isSafeInteger(generation) || generation < 1) {
      return NextResponse.json({ error: "Invalid PDF request" }, { status: 400 });
    }
    const supabase = await createServerSupabaseClient();
    await preflightKnowledgePdfStage(actor, supabase, { workspaceId, generation, documentId });
    const pages = await extractKnowledgePdfPages(new Uint8Array(await file.arrayBuffer()));
    const versionId = await stageKnowledgePdfText(actor, supabase, { workspaceId, generation, documentId, pages });
    return NextResponse.json({ versionId, pages: pages.length },
      { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceKnowledgeError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden" : "PDF could not be staged" },
        { status: error.code === "FORBIDDEN" ? 403 : error.code === "INVALID_INPUT" ? 400 : 409 });
    }
    return NextResponse.json({ error: "Invalid PDF request" }, { status: 400 });
  }
}
