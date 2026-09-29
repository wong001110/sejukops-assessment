import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getResolvedPDFJS } from "unpdf";

import type { ActorContext } from "@/lib/auth/actor-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 100_000;
const CHUNK_LENGTH = 1_800;
const MAX_CHUNKS = 64;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 12;

export type KnowledgeCitation = Readonly<{
  workspaceId: string;
  documentId: string;
  versionId: string;
  section: string;
  page: number;
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
  sourceKind: "TEXT" | "PDF_TEXT";
  indexState: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  indexError: string | null;
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

export function splitKnowledgePages(pages: readonly { page: number; text: string }[]) {
  const chunks: { page: number; content: string }[] = [];
  for (const item of pages) {
    if (!Number.isInteger(item.page) || item.page < 1 || item.page > 20 || typeof item.text !== "string") {
      throw new WorkspaceKnowledgeError("INVALID_INPUT");
    }
    if (!item.text) continue;
    const characters = Array.from(item.text);
    for (let offset = 0; offset < characters.length; offset += CHUNK_LENGTH) {
      const content = characters.slice(offset, offset + CHUNK_LENGTH).join("");
      if (!content.trim()) throw new WorkspaceKnowledgeError("INVALID_INPUT");
      chunks.push({ page: item.page, content });
    }
  }
  if (chunks.length < 1 || chunks.length > MAX_CHUNKS) throw new WorkspaceKnowledgeError("INVALID_INPUT");
  return chunks;
}

/** Only text-native PDFs are accepted. Page numbers are retained as citations. */
export async function extractKnowledgePdfPages(bytes: Uint8Array): Promise<string[]> {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PDF_BYTES ||
      new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  let loadingTask: ReturnType<Awaited<ReturnType<typeof getResolvedPDFJS>>["getDocument"]> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdfjs = await getResolvedPDFJS();
    loadingTask = pdfjs.getDocument({
      data: bytes, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
    });
    const task = loadingTask;
    timer = setTimeout(() => { void task.destroy().catch(() => {}); }, 15_000);
    const proxy = await task.promise;
    if (proxy.numPages < 1 || proxy.numPages > MAX_PDF_PAGES) throw new WorkspaceKnowledgeError("INVALID_INPUT");
    const result = await extractText(proxy, { mergePages: false });
    const pages = result.text.map((page) => page.replace(/\r\n?/g, "\n")
      .replace(/[\t ]+/g, " ").replace(/\n{4,}/g, "\n\n\n").trim().normalize("NFC"));
    if (pages.length !== proxy.numPages || pages.every((page) => !page) ||
        pages.join("\f").length > MAX_TEXT_LENGTH) throw new WorkspaceKnowledgeError("INVALID_INPUT");
    splitKnowledgePages(pages.map((text, index) => ({ page: index + 1, text })));
    return pages;
  } catch (error) {
    if (error instanceof WorkspaceKnowledgeError) throw error;
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  } finally {
    if (timer) clearTimeout(timer);
    await loadingTask?.destroy().catch(() => {});
  }
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

export async function stageKnowledgePdfText(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string; pages: string[] },
): Promise<string> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId) ||
      input.pages.length < 1 || input.pages.length > MAX_PDF_PAGES ||
      input.pages.join("\f").length > MAX_TEXT_LENGTH) throw new WorkspaceKnowledgeError("INVALID_INPUT");
  splitKnowledgePages(input.pages.map((text, index) => ({ page: index + 1, text })));
  const { data, error } = await supabase.rpc("knowledge_stage_pdf_text", {
    p_workspace_id: input.workspaceId,
    p_generation: input.generation,
    p_document_id: input.documentId,
    p_pages: input.pages,
  });
  if (error || typeof data !== "string" || !UUID.test(data)) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  return data;
}

/** Cheap caller-session preflight before PDF parsing; staging repeats the DB checks. */
export async function preflightKnowledgePdfStage(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string },
): Promise<void> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { data, error } = await supabase.from("knowledge_documents")
    .select("created_by_profile_id,generation,state")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.documentId)
    .eq("generation", input.generation)
    .neq("state", "ARCHIVED")
    .maybeSingle();
  if (error || !data || data.created_by_profile_id !== actor.profileId) {
    throw new WorkspaceKnowledgeError("FORBIDDEN");
  }
}

type IndexClaim = { token: string; page_no: number; page_text: string };

/** A claimed index token is bound to one current-generation version. */
export async function indexKnowledgeVersion(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string; versionId: string },
): Promise<void> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId) || !UUID.test(input.versionId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const args = { p_workspace_id: input.workspaceId, p_generation: input.generation,
    p_document_id: input.documentId, p_version_id: input.versionId };
  const claim = await supabase.rpc("knowledge_claim_index", args);
  if (claim.error || !Array.isArray(claim.data) || claim.data.length < 1) {
    throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  }
  const rows = claim.data as IndexClaim[];
  const token = rows[0]?.token;
  if (!UUID.test(token) || rows.some((row) => row.token !== token)) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  try {
    const chunks = splitKnowledgePages(rows.map((row) => ({ page: row.page_no, text: row.page_text })));
    const finish = await supabase.rpc("knowledge_finish_index", {
      ...args, p_token: token,
      p_page_numbers: chunks.map((chunk) => chunk.page),
      p_contents: chunks.map((chunk) => chunk.content),
    });
    if (finish.error) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
  } catch (error) {
    const code = error instanceof WorkspaceKnowledgeError && error.code === "INVALID_INPUT"
      ? "CHUNK_LIMIT" : "INDEX_FAILED";
    await supabase.rpc("knowledge_fail_index", { ...args, p_token: token, p_error_code: code });
    throw error;
  }
}

export async function retryKnowledgeIndex(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; generation: number; documentId: string; versionId: string },
): Promise<void> {
  requireWorkspace(actor, input.workspaceId, true);
  if (!validGeneration(input.generation) || !UUID.test(input.documentId) || !UUID.test(input.versionId)) {
    throw new WorkspaceKnowledgeError("INVALID_INPUT");
  }
  const { error } = await supabase.rpc("knowledge_retry_index", {
    p_workspace_id: input.workspaceId, p_generation: input.generation,
    p_document_id: input.documentId, p_version_id: input.versionId,
  });
  if (error) throw new WorkspaceKnowledgeError("COMMAND_FAILED");
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
    .select("id,source_text,source_kind,index_state,index_error,created_by_profile_id,generation")
    .eq("workspace_id", input.workspaceId)
    .eq("document_id", input.documentId)
    .eq("id", input.versionId)
    .eq("generation", input.generation)
    .maybeSingle();
  if (versionError || !version || version.created_by_profile_id !== actor.profileId) {
    throw new WorkspaceKnowledgeError("FORBIDDEN");
  }
  return {
    documentId: document.id,
    versionId: version.id,
    title: document.title,
    sourceLabel: document.source_label,
    sourceText: version.source_text,
    sourceKind: version.source_kind,
    indexState: version.index_state,
    indexError: version.index_error,
  };
}

type SearchRow = {
  workspace_id: string;
  document_id: string;
  version_id: string;
  ordinal: number;
  page_no: number;
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
        row.ordinal < 1 || row.ordinal > 64 || !Number.isInteger(row.page_no) ||
        row.page_no < 1 || row.page_no > 20 || typeof row.content !== "string") {
      throw new WorkspaceKnowledgeError("COMMAND_FAILED");
    }
    return {
      content: row.content,
      citation: {
        workspaceId: row.workspace_id,
        documentId: row.document_id,
        versionId: row.version_id,
        section: row.section_label,
        page: row.page_no,
        ordinal: row.ordinal,
        title: row.title,
        sourceLabel: row.source_label,
      },
      trust: "UNTRUSTED_SOURCE" as const,
      retrieval: "KEYWORD_ONLY" as const,
    };
  });
}
