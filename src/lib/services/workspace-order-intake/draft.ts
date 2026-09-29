import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DOCUMENT_IMPORT_POLICY, type ValidatedServiceDocumentDraft } from "@/domain/document-understanding/contracts";
import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { resolveAIProviderForActorTask } from "@/lib/services/ai-config/service";
import { runDocumentExtraction } from "@/lib/services/document-understanding/runtime";
import { extractKnowledgePdfPages } from "@/lib/services/workspace-knowledge/service";
import { readWorkspaceGeneration } from "@/lib/services/workspaces/generation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type OrderIntakeMimeType = "text/plain" | "application/pdf";
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export class WorkspaceOrderIntakeError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID_INPUT" | "STALE" | "UNAVAILABLE" |
    "AI_ALLOWANCE_EXHAUSTED" | "AI_ALLOWANCE_UNAVAILABLE", readonly resetAt?: string) {
    super(`Workspace order intake ${code.toLowerCase()}`);
    this.name = "WorkspaceOrderIntakeError";
  }
}

function assertIntakeActor(actor: ActorContext, workspaceId: string): void {
  if (!UUID.test(workspaceId) || actor.membership?.workspaceId !== workspaceId ||
      actor.membership.role !== "ADMIN" ||
      !hasActorPermission(actor, "order:create") || !hasActorPermission(actor, "ai:use")) {
    throw new WorkspaceOrderIntakeError("FORBIDDEN");
  }
}

function assertSource(mimeType: OrderIntakeMimeType, bytes: Uint8Array): void {
  const maximum = mimeType === "text/plain"
    ? DOCUMENT_IMPORT_POLICY.maximumTextBytes : MAX_PDF_BYTES;
  if (bytes.byteLength < 1 || bytes.byteLength > maximum ||
      (mimeType === "application/pdf" &&
       new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")) {
    throw new WorkspaceOrderIntakeError("INVALID_INPUT");
  }
}

type Dependencies = Readonly<{
  resolveProvider?: typeof resolveAIProviderForActorTask;
  extract?: typeof runDocumentExtraction;
  extractPdfPages?: typeof extractKnowledgePdfPages;
  readGeneration?: typeof readWorkspaceGeneration;
  beforeProviderCall?: () => Promise<void>;
}>;

/**
 * The model returns suggestions only. This function has no order/customer
 * mutation or KB publication path; confirmation uses the normal order command.
 */
export async function prepareWorkspaceOrderDraft(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: { workspaceId: string; mimeType: OrderIntakeMimeType; bytes: Uint8Array },
  dependencies: Dependencies = {},
): Promise<{ draft: ValidatedServiceDocumentDraft; generation: number; sourceSha256: string }> {
  assertIntakeActor(actor, input.workspaceId);
  assertSource(input.mimeType, input.bytes);
  const readGeneration = dependencies.readGeneration ?? readWorkspaceGeneration;
  const before = await readGeneration(actor, supabase, input.workspaceId);
  let draft: ValidatedServiceDocumentDraft;
  try {
    // Use the KB parser's bounded, disabled-eval PDF text extraction, but do
    // not stage or publish anything to the KB. The model sees plain text only.
    const sourceTextBytes = input.mimeType === "application/pdf"
      ? new TextEncoder().encode((await (dependencies.extractPdfPages ?? extractKnowledgePdfPages)(input.bytes)).join("\n\n"))
      : input.bytes;
    const provider = await (dependencies.resolveProvider ?? resolveAIProviderForActorTask)(
      actor, "DOCUMENT_UNDERSTANDING", "TEXT",
    );
    draft = await (dependencies.extract ?? runDocumentExtraction)(provider, "text/plain", sourceTextBytes,
      { beforeProviderCall: dependencies.beforeProviderCall });
  } catch (error) {
    if (error instanceof WorkspaceOrderIntakeError) throw error;
    throw new WorkspaceOrderIntakeError("UNAVAILABLE");
  }
  const after = await readGeneration(actor, supabase, input.workspaceId);
  if (before !== after) throw new WorkspaceOrderIntakeError("STALE");
  return {
    draft,
    generation: after,
    sourceSha256: createHash("sha256").update(input.bytes).digest("hex"),
  };
}
