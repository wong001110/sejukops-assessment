import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import {
  createKnowledgeDocument,
  publishKnowledgeVersion,
  readKnowledgeVersionForReview,
  searchWorkspaceKnowledge,
  stageKnowledgeText,
  WorkspaceKnowledgeError,
} from "@/lib/services/workspace-knowledge/service";
import { readWorkspaceGeneration, WorkspaceGenerationError } from "@/lib/services/workspaces/generation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const uuid = z.string().uuid();
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), generation: z.number().int().positive(),
    title: z.string().min(1).max(160), sourceLabel: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("stage"), generation: z.number().int().positive(),
    documentId: uuid, sourceText: z.string().min(1).max(100_000) }).strict(),
  z.object({ action: z.literal("publish"), generation: z.number().int().positive(),
    documentId: uuid, versionId: uuid }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof WorkspaceKnowledgeError || error instanceof WorkspaceGenerationError) {
    const forbidden = error.code === "FORBIDDEN";
    return NextResponse.json(
      { error: forbidden ? "Forbidden" : error.code === "INVALID_INPUT" ? "Invalid request" : "Knowledge unavailable" },
      { status: forbidden ? 403 : error.code === "INVALID_INPUT" ? 400 : 409 },
    );
  }
  return NextResponse.json({ error: "Knowledge unavailable" }, { status: 500 });
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const generation = await readWorkspaceGeneration(actor, supabase, workspaceId);
    const url = new URL(request.url);
    const reviewDocumentId = url.searchParams.get("reviewDocumentId");
    const reviewVersionId = url.searchParams.get("reviewVersionId");
    if (reviewDocumentId || reviewVersionId) {
      if (!reviewDocumentId || !reviewVersionId) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      const review = await readKnowledgeVersionForReview(actor, supabase, {
        workspaceId, generation, documentId: reviewDocumentId, versionId: reviewVersionId,
      });
      return NextResponse.json({ generation, review }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const query = url.searchParams.get("query");
    if (query !== null) {
      const hits = await searchWorkspaceKnowledge(actor, supabase, { workspaceId, query });
      return NextResponse.json({ generation, hits }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ generation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { workspaceId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = command.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const input = parsed.data;
    if (input.action === "create") {
      const documentId = await createKnowledgeDocument(actor, supabase, { workspaceId, ...input });
      return NextResponse.json({ documentId }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    if (input.action === "stage") {
      const versionId = await stageKnowledgeText(actor, supabase, { workspaceId, ...input });
      return NextResponse.json({ versionId }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    await publishKnowledgeVersion(actor, supabase, { workspaceId, ...input });
    return NextResponse.json({ published: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
