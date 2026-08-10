import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdminBranchOption,
  AdminTechnicianOption,
} from "@/domain/admin-orders/contracts";
import {
  DOCUMENT_IMPORT_POLICY,
  documentImportMimeTypeSchema,
  validatedServiceDocumentDraftSchema,
  type ConfirmDocumentImportInput,
  type ConfirmDocumentImportResponse,
  type ConfirmDocumentSourceInput,
  type DocumentExtractionFailureCode,
  type DocumentImportDetailResponse,
  type DocumentImportFailure,
  type DocumentImportRecord,
  type DocumentImportReservationResponse,
  type ExtractDocumentImportInput,
  type ReserveDocumentImportInput,
  type ValidatedServiceDocumentDraft,
} from "@/domain/document-understanding/contracts";
import { DocumentUnderstandingError } from "@/domain/document-understanding/errors";
import { AIConfigError, AI_ERROR_MESSAGES } from "@/domain/ai-config/errors";
import type { OrderStatus } from "@/domain/operations";
import {
  isRetryableAIProviderError,
  type AIProviderConnectionConfig,
} from "@/lib/ai/providers";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";
import { resolveAIProviderForTask } from "@/lib/services/ai-config/service";
import { getAdminOrderDetail } from "@/lib/services/admin-orders/service";

import {
  runDocumentExtraction,
  type DocumentRuntimeDependencies,
} from "./runtime";
import { normalizeDocumentStorageMetadata } from "./storage-metadata";

type DataRecord = Record<string, unknown>;
type DocumentContext = Awaited<ReturnType<typeof createDocumentContext>>;

export type DocumentExtractionServiceDependencies = DocumentRuntimeDependencies &
  Readonly<{
    resolveProvider?: (
      task: "DOCUMENT_UNDERSTANDING",
      inputKind: "TEXT" | "IMAGE",
    ) => Promise<AIProviderConnectionConfig & Readonly<{ providerConfigId: string | null }>>;
  }>;

function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_DATA_ACCESS_FAILED",
      "Document import data could not be read.",
      503,
    );
  }
  return value as DataRecord;
}

function relation(value: unknown): DataRecord {
  return asRecord(Array.isArray(value) ? value[0] : value);
}

function optionalRelation(value: unknown): DataRecord | null {
  if (value === null || value === undefined) return null;
  return relation(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function normalizeRpcRow(value: unknown): DataRecord {
  if (Array.isArray(value)) {
    if (!value[0]) throwDataError(null);
    return asRecord(value[0]);
  }
  return asRecord(value);
}

async function createDocumentContext() {
  const context = await createAuthorizedDataContext("ai:use");
  if (context.identity.role !== "ADMIN") {
    throw new DocumentUnderstandingError(
      "DOCUMENT_PERMISSION_DENIED",
      "Document import is available to Admin users only.",
      403,
    );
  }
  return context;
}

function throwDataError(error: { message: string; code?: string } | null): never {
  const message = error?.message ?? "Unknown document data error";
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("DOCUMENT_EXTRACTION_IN_PROGRESS") ||
    message.includes("DOCUMENT_EXTRACTION_SUPERSEDED") ||
    message.includes("DOCUMENT_ALREADY_CONFIRMED") ||
    message.includes("DOCUMENT_NOT_READY_FOR_CONFIRMATION") ||
    message.includes("DOCUMENT_SOURCE_NOT_UPLOADED")
  ) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_CONFLICT",
      "The document import changed. Refresh before trying again.",
      409,
    );
  }
  if (
    message.includes("DOCUMENT_MIME_NOT_ALLOWED") ||
    message.includes("DOCUMENT_FILE_TOO_LARGE") ||
    message.includes("INVALID_DOCUMENT_FILENAME") ||
    message.includes("STORAGE_METADATA_MISMATCH")
  ) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_VALIDATION_FAILED",
      "The uploaded source does not match the allowed document policy.",
      400,
    );
  }
  if (message.includes("INVALID_ADMIN_ACTOR")) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_PERMISSION_DENIED",
      "An active Admin session is required.",
      403,
    );
  }
  if (error?.code === "PGRST116" || message.includes("DOCUMENT_IMPORT_NOT_FOUND")) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_NOT_FOUND",
      "The requested document import was not found.",
      404,
    );
  }
  throw new DocumentUnderstandingError(
    "DOCUMENT_DATA_ACCESS_FAILED",
    "Document import data is temporarily unavailable. Please try again.",
    503,
  );
}

const FAILURE_DETAILS: Readonly<Record<DocumentExtractionFailureCode, Omit<DocumentImportFailure, "code">>> = {
  AI_NOT_CONFIGURED: {
    message: AI_ERROR_MESSAGES.AI_NOT_CONFIGURED,
    retryable: false,
    recoveryAction: "CONFIGURE_PROVIDER",
  },
  AI_CAPABILITY_MISMATCH: {
    message: AI_ERROR_MESSAGES.AI_CAPABILITY_MISMATCH,
    retryable: false,
    recoveryAction: "CONFIGURE_PROVIDER",
  },
  AI_AUTH_FAILED: {
    message: AI_ERROR_MESSAGES.AI_AUTH_FAILED,
    retryable: false,
    recoveryAction: "CONFIGURE_PROVIDER",
  },
  AI_RATE_LIMITED: {
    message: AI_ERROR_MESSAGES.AI_RATE_LIMITED,
    retryable: true,
    recoveryAction: "RETRY_EXTRACTION",
  },
  AI_TIMEOUT: {
    message: AI_ERROR_MESSAGES.AI_TIMEOUT,
    retryable: true,
    recoveryAction: "RETRY_EXTRACTION",
  },
  AI_PROVIDER_UNAVAILABLE: {
    message: AI_ERROR_MESSAGES.AI_PROVIDER_UNAVAILABLE,
    retryable: true,
    recoveryAction: "RETRY_EXTRACTION",
  },
  AI_INVALID_RESPONSE: {
    message: AI_ERROR_MESSAGES.AI_INVALID_RESPONSE,
    retryable: true,
    recoveryAction: "RETRY_EXTRACTION",
  },
  DOCUMENT_STORAGE_FAILED: {
    message: "The uploaded source could not be read from private storage. Upload the source again.",
    retryable: false,
    recoveryAction: "REUPLOAD_SOURCE",
  },
  DOCUMENT_TEXT_UNREADABLE: {
    message: "No safe readable text was found. Upload a text-native PDF or use a supported image with a vision-capable model.",
    retryable: false,
    recoveryAction: "UPLOAD_READABLE_SOURCE",
  },
  DOCUMENT_EXTRACTION_FAILED: {
    message: "The document could not be extracted safely. Please retry.",
    retryable: true,
    recoveryAction: "RETRY_EXTRACTION",
  },
  DOCUMENT_DATA_ACCESS_FAILED: {
    message: "Document import data is temporarily unavailable.",
    retryable: true,
    recoveryAction: "CONTACT_SUPPORT",
  },
};

function safeFailure(code: string | null, persistedRetryable?: boolean | null): DocumentImportFailure | null {
  if (!code || !(code in FAILURE_DETAILS)) return null;
  const typedCode = code as DocumentExtractionFailureCode;
  const details = FAILURE_DETAILS[typedCode];
  return {
    code: typedCode,
    ...details,
    retryable: persistedRetryable ?? details.retryable,
  };
}

function mapFailure(error: unknown): DocumentImportFailure {
  if (error instanceof AIConfigError) {
    const supported = error.code in FAILURE_DETAILS
      ? error.code as DocumentExtractionFailureCode
      : "DOCUMENT_EXTRACTION_FAILED";
    const failure = safeFailure(supported);
    if (!failure) throw new Error("Unreachable failure mapping");
    return {
      ...failure,
      retryable: isRetryableAIProviderError(error) || failure.retryable,
    };
  }
  if (error instanceof DocumentUnderstandingError) {
    const code: DocumentExtractionFailureCode =
      error.code === "DOCUMENT_STORAGE_FAILED"
        ? "DOCUMENT_STORAGE_FAILED"
        : error.code === "DOCUMENT_TEXT_UNREADABLE" || error.code === "DOCUMENT_VALIDATION_FAILED"
          ? "DOCUMENT_TEXT_UNREADABLE"
          : error.code === "DOCUMENT_DATA_ACCESS_FAILED"
            ? "DOCUMENT_DATA_ACCESS_FAILED"
            : "DOCUMENT_EXTRACTION_FAILED";
    const failure = safeFailure(code);
    if (failure) return failure;
  }
  const fallback = safeFailure("DOCUMENT_EXTRACTION_FAILED");
  if (!fallback) throw new Error("Unreachable failure mapping");
  return fallback;
}

async function getImportRow(context: DocumentContext, id: string): Promise<DataRecord> {
  const { data, error } = await context.supabase
    .from("document_imports")
    .select(
      "id,uploaded_by,upload_request_key,storage_bucket,storage_path,original_filename,mime_type,size_bytes,source_status,extraction_status,extraction_attempt_count,extracted_json,failure_code,failure_retryable,source_uploaded_at,confirmation_customer_reused,confirmed_order_id,confirmed_order:orders!document_imports_confirmed_order_id_fkey(id,order_no,status),created_at,updated_at",
    )
    .eq("id", id)
    .eq("uploaded_by", context.identity.profileId)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) throwDataError({ message: "DOCUMENT_IMPORT_NOT_FOUND", code: "PGRST116" });
  return asRecord(data);
}

async function mapImport(
  context: DocumentContext,
  row: DataRecord,
  includeSourceUrl: boolean,
  extractionOverride?: Readonly<{
    status: "PENDING" | "SUCCEEDED" | "FAILED";
    extractedJson: unknown;
    failureCode: string | null;
    failureRetryable: boolean | null;
  }>,
): Promise<DocumentImportRecord> {
  let sourceUrl: string | null = null;
  if (includeSourceUrl && text(row.source_status) === "UPLOADED") {
    const { data } = await context.supabase.storage
      .from(text(row.storage_bucket))
      .createSignedUrl(text(row.storage_path), 300);
    sourceUrl = data?.signedUrl ?? null;
  }
  const draftValue = extractionOverride
    ? extractionOverride.extractedJson
    : row.extracted_json;
  const confirmedOrder = optionalRelation(row.confirmed_order);
  return {
    id: text(row.id),
    originalFilename: text(row.original_filename),
    mimeType: documentImportMimeTypeSchema.parse(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sourceStatus: text(row.source_status) as DocumentImportRecord["sourceStatus"],
    extractionStatus: extractionOverride
      ? extractionOverride.status === "SUCCEEDED"
        ? "EXTRACTED"
        : extractionOverride.status === "FAILED"
          ? "FAILED"
          : "EXTRACTING"
      : text(row.extraction_status) as DocumentImportRecord["extractionStatus"],
    extractionAttemptCount: Number(row.extraction_attempt_count),
    sourceUploadedAt: nullableText(row.source_uploaded_at),
    draft: draftValue
      ? validatedServiceDocumentDraftSchema.parse(draftValue)
      : null,
    failure: safeFailure(
      extractionOverride
        ? extractionOverride.failureCode
        : nullableText(row.failure_code),
      extractionOverride
        ? extractionOverride.failureRetryable
        : row.failure_retryable === null
          ? null
          : Boolean(row.failure_retryable),
    ),
    confirmedOrderId: nullableText(row.confirmed_order_id),
    confirmation: confirmedOrder
      ? {
          orderId: text(confirmedOrder.id),
          orderNo: text(confirmedOrder.order_no),
          status: text(confirmedOrder.status) as OrderStatus,
          customerReused: Boolean(row.confirmation_customer_reused),
        }
      : null,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    sourceUrl,
  };
}

async function getExtractionRequestOutcome(
  context: DocumentContext,
  documentImportId: string,
  requestKey: string,
) {
  const { data, error } = await context.supabase
    .from("document_import_extraction_requests")
    .select("status,extracted_json,failure_code,failure_retryable")
    .eq("request_key", requestKey)
    .eq("document_import_id", documentImportId)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) throwDataError({ message: "DOCUMENT_EXTRACTION_SUPERSEDED" });
  const row = asRecord(data);
  return {
    status: text(row.status) as "PENDING" | "SUCCEEDED" | "FAILED",
    extractedJson: row.extracted_json,
    failureCode: nullableText(row.failure_code),
    failureRetryable:
      row.failure_retryable === null ? null : Boolean(row.failure_retryable),
  };
}

async function getOptions(supabase: SupabaseClient) {
  const [branches, technicians] = await Promise.all([
    supabase.from("branches").select("id,code,name").eq("active", true).order("code"),
    supabase
      .from("technicians")
      .select("id,branch_id,branch:branches!technicians_branch_id_fkey(code),profile:profiles!technicians_profile_id_fkey(display_name,active)")
      .eq("active", true),
  ]);
  if (branches.error) throwDataError(branches.error);
  if (technicians.error) throwDataError(technicians.error);
  const branchOptions: AdminBranchOption[] = (branches.data ?? []).map((value) => {
    const row = asRecord(value);
    return { id: text(row.id), code: text(row.code), name: text(row.name) };
  });
  const technicianOptions: AdminTechnicianOption[] = (technicians.data ?? [])
    .map((value) => {
      const row = asRecord(value);
      const profile = relation(row.profile);
      if (profile.active !== true) return null;
      return {
        id: text(row.id),
        name: text(profile.display_name),
        branchId: text(row.branch_id),
        branchCode: text(relation(row.branch).code),
      };
    })
    .filter((value): value is AdminTechnicianOption => value !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { branches: branchOptions, technicians: technicianOptions };
}

export async function reserveDocumentImport(
  input: ReserveDocumentImportInput,
): Promise<DocumentImportReservationResponse> {
  const context = await createDocumentContext();
  const { data, error } = await context.supabase.rpc("admin_reserve_document_import", {
    p_actor_profile_id: context.identity.profileId,
    p_original_filename: input.originalFilename,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const row = await getImportRow(context, text(result.document_import_id));
  if (text(result.source_status) !== "RESERVED") {
    return { documentImport: await mapImport(context, row, true), upload: null };
  }
  const { data: authorization, error: storageError } = await context.supabase.storage
    .from(DOCUMENT_IMPORT_POLICY.bucket)
    .createSignedUploadUrl(text(result.storage_path), { upsert: true });
  if (storageError || !authorization) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_STORAGE_FAILED",
      "The private source upload could not be prepared. Retry with the same request key.",
      502,
      { cause: storageError ?? undefined },
    );
  }
  return {
    documentImport: await mapImport(context, row, false),
    upload: {
      bucket: DOCUMENT_IMPORT_POLICY.bucket,
      path: authorization.path,
      token: authorization.token,
    },
  };
}

async function inspectStorageObject(context: DocumentContext, row: DataRecord) {
  const path = text(row.storage_path);
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const filename = path.slice(slash + 1);
  const { data, error } = await context.supabase.storage
    .from(text(row.storage_bucket))
    .list(folder, { limit: 10, search: filename });
  if (error) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_STORAGE_FAILED",
      "The private source could not be verified. Retry confirmation.",
      502,
      { cause: error },
    );
  }
  const file = data?.find((candidate) => candidate.name === filename);
  const metadata = file?.metadata && typeof file.metadata === "object"
    ? file.metadata as Record<string, unknown>
    : null;
  if (!file || !metadata) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_STORAGE_FAILED",
      "The private source metadata could not be verified. Upload the source again.",
      502,
    );
  }
  return normalizeDocumentStorageMetadata(metadata);
}

export async function confirmDocumentSource(
  id: string,
  input: ConfirmDocumentSourceInput,
) {
  const context = await createDocumentContext();
  const row = await getImportRow(context, id);
  if (text(row.upload_request_key) !== input.requestKey) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_CONFLICT",
      "The upload request key does not match this source.",
      409,
    );
  }
  if (text(row.source_status) !== "UPLOADED") {
    const actual = await inspectStorageObject(context, row);
    if (actual.mimeType !== text(row.mime_type) || actual.sizeBytes !== Number(row.size_bytes)) {
      throw new DocumentUnderstandingError(
        "DOCUMENT_VALIDATION_FAILED",
        "The uploaded source does not match its reserved type or size.",
        400,
      );
    }
    const { error } = await context.supabase.rpc("admin_confirm_document_source", {
      p_actor_profile_id: context.identity.profileId,
      p_document_import_id: id,
      p_request_key: input.requestKey,
      p_actual_mime_type: actual.mimeType,
      p_actual_size_bytes: actual.sizeBytes,
    });
    if (error) throwDataError(error);
  }
  return { documentImport: await mapImport(context, await getImportRow(context, id), true) };
}

async function downloadSource(context: DocumentContext, row: DataRecord): Promise<Uint8Array> {
  const { data, error } = await context.supabase.storage
    .from(text(row.storage_bucket))
    .download(text(row.storage_path));
  if (error || !data) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_STORAGE_FAILED",
      "The uploaded source could not be read from private storage.",
      502,
      { cause: error ?? undefined },
    );
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== Number(row.size_bytes)) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_STORAGE_FAILED",
      "The uploaded source changed after verification. Upload it again.",
      502,
    );
  }
  return bytes;
}

function validationIssues(draft: ValidatedServiceDocumentDraft) {
  return Object.fromEntries(
    Object.entries(draft).map(([field, value]) => [field, value.issues]),
  );
}

export async function extractDocumentImport(
  id: string,
  input: ExtractDocumentImportInput,
  dependencies: DocumentExtractionServiceDependencies = {},
) {
  const context = await createDocumentContext();
  const { data, error } = await context.supabase.rpc("admin_begin_document_extraction", {
    p_actor_profile_id: context.identity.profileId,
    p_document_import_id: id,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const begin = normalizeRpcRow(data);
  if (begin.should_execute !== true) {
    const outcome = await getExtractionRequestOutcome(context, id, input.requestKey);
    return {
      documentImport: await mapImport(
        context,
        await getImportRow(context, id),
        true,
        outcome,
      ),
    };
  }

  try {
    const row = await getImportRow(context, id);
    const mimeType = documentImportMimeTypeSchema.parse(row.mime_type);
    const inputKind = mimeType.startsWith("image/") ? "IMAGE" : "TEXT";
    const provider = await (dependencies.resolveProvider ?? resolveAIProviderForTask)(
      "DOCUMENT_UNDERSTANDING",
      inputKind,
    );
    if (!provider.providerConfigId) {
      throw new AIConfigError(
        "AI_NOT_CONFIGURED",
        AI_ERROR_MESSAGES.AI_NOT_CONFIGURED,
        503,
      );
    }
    const draft = await runDocumentExtraction(
      provider,
      mimeType,
      await downloadSource(context, row),
      dependencies,
    );
    const { error: finishError } = await context.supabase.rpc(
      "admin_finish_document_extraction",
      {
        p_actor_profile_id: context.identity.profileId,
        p_document_import_id: id,
        p_request_key: input.requestKey,
        p_provider_config_id: provider.providerConfigId,
        p_extracted_json: draft,
        p_validation_issues: validationIssues(draft),
      },
    );
    if (finishError) throwDataError(finishError);
  } catch (extractionError) {
    const failure = mapFailure(extractionError);
    const { error: failError } = await context.supabase.rpc(
      "admin_fail_document_extraction",
      {
        p_actor_profile_id: context.identity.profileId,
        p_document_import_id: id,
        p_request_key: input.requestKey,
        p_failure_code: failure.code,
        p_retryable: failure.retryable,
      },
    );
    if (failError) throwDataError(failError);
  }
  return { documentImport: await mapImport(context, await getImportRow(context, id), true) };
}

export async function getDocumentImport(id: string): Promise<DocumentImportDetailResponse> {
  const context = await createDocumentContext();
  const [documentImport, options] = await Promise.all([
    getImportRow(context, id).then((row) => mapImport(context, row, true)),
    getOptions(context.supabase),
  ]);
  return { documentImport, options };
}

export async function confirmDocumentImport(
  id: string,
  input: ConfirmDocumentImportInput,
): Promise<ConfirmDocumentImportResponse> {
  const context = await createDocumentContext();
  const { data, error } = await context.supabase.rpc(
    "admin_confirm_document_import_create",
    {
      p_actor_profile_id: context.identity.profileId,
      p_document_import_id: id,
      p_request_key: input.requestKey,
      p_customer_name: input.reviewed.customerName,
      p_customer_phone: input.reviewed.customerPhone,
      p_customer_address: input.reviewed.customerAddress,
      p_branch_id: input.reviewed.branchId,
      p_technician_id: input.reviewed.technicianId ?? null,
      p_service_type: input.reviewed.serviceType,
      p_service_details: input.reviewed.serviceDetails,
      p_amount: input.reviewed.amount,
      p_service_date: input.reviewed.date,
      p_admin_notes: input.reviewed.adminNotes ?? null,
    },
  );
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const detail = await getAdminOrderDetail(text(result.order_id));
  return {
    documentImport: await mapImport(context, await getImportRow(context, id), true),
    order: detail.order,
    customerReused: Boolean(result.customer_reused),
  };
}
