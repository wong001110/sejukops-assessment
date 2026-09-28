import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 100_000;
const CHUNK_LENGTH = 1_800;
const MAX_CHUNKS = 64;

export type KnowledgeCitation = Readonly<{
  workspaceId: string;
  documentId: string;
  versionId: string;
  section: string;
  ordinal: number;
  title: string;
  sourceLabel: string;
}>;

export type KnowledgeHit = Readonly<{
  content: string;
  citation: KnowledgeCitation;
  /** Source text is evidence, never an instruction to the agent or a tool. */
  trust: "UNTRUSTED_SOURCE";
  retrieval: "KEYWORD_ONLY";
}>;

export type KnowledgeVersionReview = Readonly<{
  documentId: string;
  versionId: string;
  title: string;
  sourceLabel: string;
  sourceText: string;
  indexState: "READY";
}>;

export class WorkspaceKnowledgeError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "COMMAND_FAILED") {
    super(`Workspace knowledge ${code.toLowerCase()}`);
    this.name = "WorkspaceKnowledgeError";
  }
}

function requireWorkspace(actor: ActorContext, workspaceId: string, edit = false) {
  const membership = actor.membership;
  if (
    !UUID.test(workspaceId) ||
    membership?.workspaceId !== workspaceId ||
    (actor.isAnonymous && membership.kind !== "DEMO") ||
    (edit && membership.role !== "ADMIN" && membership.role !== "MANAGER")
  ) {
    throw new WorkspaceKnowledgeError("FORBIDDEN");
  }
}

function validGeneration(generation: number): boolean {
  return Number.isSafeInteger(generation) && generation > 0;
}

function validText(value: string, maximum: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

/** Deterministic plain-text sections; no parser, embedding, or model trust. */
export function splitKnowledgeText(sourceText: string): string[] {
  if (!validText(sourceText, MAX_TEXT_LENGTH)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const text = sourceText.trim().normalize("NFC");
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length; offset += CHUNK_LENGTH) {
    chunks.push(characters.slice(offset, offset + CHUNK_LENGTH).join(""));
  }
  if (chunks.length > MAX_CHUNKS || chunks.some((chunk) => !chunk.trim())) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  return chunks;
}

/** The supplied client must carry this actor's Supabase Auth session. */
export async function createKnowledgeDocument(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; title: string; sourceLabel: string },
): Promise<string> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !validText(input.title, 160) ||
      !validText(input.sourceLabel, 160)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { data, error } = await supabase.rpc("knowledge_create_document", {
    p_workspace_id: input.workspaceId,
    p_generation: input.generation,
    p_title: input.title.trim(),
    p_source_label: input.sourceLabel.trim(),
  });
  if (error || typeof data !== "string" || !UUID.test(data)) {
    throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  }
  return data;
}

export async function stageKnowledgeText(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string; sourceText: string },
): Promise<string> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  if (!validText(input.sourceText, MAX_TEXT_LENGTH)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const sourceText = input.sourceText.trim().normalize("NFC");
  const chunks = splitKnowledgeText(sourceText);
  const { data, error } = await supabase.rpc("knowledge_stage_text", {
    p_workspace_id: input.workspaceId,
    p_generation: input.generation,
    p_document_id: input.documentId,
    p_source_text: sourceText,
    p_chunks: chunks,
  });
  if (error || typeof data !== "string" || !UUID.test(data)) {
    throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  }
  return data;
}

/** Explicit human review action; the database rechecks owner and current generation. */
export async function publishKnowledgeVersion(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string; versionId: string },
): Promise<void> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId) || !UUID.test(input.versionId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { error } = await supabase.rpc("knowledge_publish", {
    p_workspace_id: input.workspaceId,
    p_generation: input.generation,
    p_document_id: input.documentId,
    p_version_id: input.versionId,
  });
  if (error) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
}

export async function archiveKnowledgeDocument(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string },
): Promise<void> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { error } = await supabase.rpc("knowledge_archive", {
    p_workspace_id: input.workspaceId,
    p_generation: input.generation,
    p_document_id: input.documentId,
  });
  if (error) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
}

/** Read the persisted source before presenting a separate publish action. */
export async function readKnowledgeVersionForReview(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string; versionId: string },
): Promise<KnowledgeVersionReview> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId) || !UUID.test(input.versionId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { data: document, error: documentError } = await supabase
    .from("knowledge_documents")
    .select("id,title,source_label,created_by_profile_id,state,generation")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.documentId)
    .eq("generation", input.generation)
    .maybeSingle();
  if (documentError || !document || document.created_by_profile_id !== actor.profileId ||
      document.state === "ARCHIVED") throw new WorkspaceKnowledgeError("FORBIDDEN");

  const { data: version, error: versionError } = await supabase
    .from("knowledge_versions")
    .select("id,source_text,index_state,created_by_profile_id,generation")
    .eq("workspace_id", input.workspaceId)
    .eq("document_id", input.documentId)
    .eq("id", input.versionId)
    .eq("generation", input.generation)
    .maybeSingle();
  if (versionError || !version || version.created_by_profile_id !== actor.profileId ||
      version.index_state !== "READY") throw new WorkspaceKnowledgeError("FORBIDDEN");
  return {
    documentId: document.id,
    versionId: version.id,
    title: document.title,
    sourceLabel: document.source_label,
    sourceText: version.source_text,
    indexState: "READY",
  };
}

type SearchRow = {
  workspace_id: string;
  document_id: string;
  version_id: string;
  ordinal: number;
  title: string;
  source_label: string;
  section_label: string;
  content: string;
};

/** Literal substring retrieval. Empty results mean insufficient knowledge. */
export async function searchWorkspaceKnowledge(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; query: string; limit?: number },
): Promise<KnowledgeHit[]> {
  requireWorkspace(actor, input.workspaceId);
  if (!validText(input.query, 120) ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20))) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { data, error } = await supabase.rpc("knowledge_search_keyword", {
    p_workspace_id: input.workspaceId,
    p_query: input.query.trim(),
    p_limit: input.limit ?? 10,
  });
  if (error || !Array.isArray(data)) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  return (data as SearchRow[]).map((row) => {
    if (row.workspace_id !== input.workspaceId || !UUID.test(row.document_id) ||
        !UUID.test(row.version_id) || !Number.isInteger(row.ordinal) ||
        row.ordinal < 1 || row.ordinal > 64 || typeof row.content !== "string") {
      throw new WorkspaceKnowledgeError("COMMAND_FAILED");
    }
    return {
      content: row.content,
      citation: {
        workspaceId: row.workspace_id,
        documentId: row.document_id,
        versionId: row.version_id,
        section: row.section_label,
        ordinal: row.ordinal,
        title: row.title,
        sourceLabel: row.source_label,
      },
      trust: "UNTRUSTED_SOURCE" as const,
      retrieval: "KEYWORD_ONLY" as const,
    };
  });
}
