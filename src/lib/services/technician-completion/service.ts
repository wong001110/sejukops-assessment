import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CompleteTechnicianJobInput,
  ConfirmEvidenceUploadInput,
  EvidenceReservationResponse,
  EvidenceUploadStatus,
  ReserveEvidenceUploadInput,
  TechnicianCompletionPayment,
  TechnicianCompletionReport,
  TechnicianCompletionResponse,
  TechnicianEvidenceItem,
} from "@/domain/technician-completion/contracts";
import { TECHNICIAN_EVIDENCE_POLICY } from "@/domain/technician-completion/contracts";
import { TechnicianCompletionError } from "@/domain/technician-completion/errors";
import { requirePermission, type AppPermission } from "@/lib/auth/permissions";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

import { normalizeStorageObjectMetadata } from "./storage-metadata";

type DataRecord = Record<string, unknown>;
type CompletionContext = Awaited<ReturnType<typeof createCompletionContext>>;

function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_DATA_ACCESS_FAILED",
      "Completion data could not be read.",
      503,
    );
  }
  return value as DataRecord;
}

function relation(value: unknown): DataRecord {
  return asRecord(Array.isArray(value) ? value[0] : value);
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

function throwDataError(error: { message: string; code?: string } | null): never {
  const message = error?.message ?? "Unknown data error";
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("JOB_NOT_IN_PROGRESS") ||
    message.includes("JOB_NOT_COMPLETABLE") ||
    message.includes("JOB_ALREADY_COMPLETED") ||
    message.includes("EVIDENCE_UPLOAD_PENDING") ||
    message.includes("EVIDENCE_UPLOAD_NOT_CONFIRMABLE") ||
    message.includes("ATTACHED_EVIDENCE_IMMUTABLE")
  ) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_CONFLICT",
      "The job or evidence changed. Refresh before trying again.",
      409,
    );
  }
  if (
    message.includes("EVIDENCE_MIME_NOT_ALLOWED") ||
    message.includes("EVIDENCE_FILE_TOO_LARGE") ||
    message.includes("EVIDENCE_FILE_COUNT_EXCEEDED") ||
    message.includes("EVIDENCE_TOTAL_SIZE_EXCEEDED") ||
    message.includes("STORAGE_METADATA_MISMATCH") ||
    message.includes("WORK_DONE_REQUIRED") ||
    message.includes("INVALID_EXTRA_CHARGES") ||
    message.includes("INVALID_FINAL_AMOUNT") ||
    message.includes("INCOMPLETE_PAYMENT") ||
    message.includes("INVALID_PAYMENT")
  ) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_VALIDATION_FAILED",
      "The submitted evidence or completion values are not valid.",
      400,
    );
  }
  if (message.includes("JOB_NOT_ASSIGNED")) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_PERMISSION_DENIED",
      "This job is not assigned to the current Technician.",
      403,
    );
  }
  if (message.includes("INVALID_TECHNICIAN_ACTOR")) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_PERMISSION_DENIED",
      "An active Technician session is required.",
      403,
    );
  }
  if (
    error?.code === "PGRST116" ||
    message.includes("JOB_NOT_FOUND") ||
    message.includes("EVIDENCE_UPLOAD_NOT_FOUND")
  ) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_NOT_FOUND",
      "The requested job or evidence was not found.",
      404,
    );
  }
  throw new TechnicianCompletionError(
    "TECHNICIAN_COMPLETION_DATA_ACCESS_FAILED",
    "Completion data is temporarily unavailable. Please try again.",
    503,
    { cause: error ?? undefined },
  );
}

async function createCompletionContext(permission: AppPermission) {
  const context = await createAuthorizedDataContext(permission);
  if (context.identity.role !== "TECHNICIAN") {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_PERMISSION_DENIED",
      "This operation is available to Technician users only.",
      403,
    );
  }
  const { data, error } = await context.supabase
    .from("technicians")
    .select("id,profile:profiles!technicians_profile_id_fkey(active,role)")
    .eq("profile_id", context.identity.profileId)
    .eq("active", true)
    .maybeSingle();
  if (error) throwDataError(error);
  const technician = data ? asRecord(data) : null;
  const profile = technician ? relation(technician.profile) : null;
  if (!technician || profile?.active !== true || profile.role !== "TECHNICIAN") {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_PERMISSION_DENIED",
      "The Technician profile is inactive or unavailable.",
      403,
    );
  }
  return { ...context, technicianId: text(technician.id) };
}

async function requireAssignedOrder(
  supabase: SupabaseClient,
  technicianId: string,
  orderId: string,
) {
  const { data, error } = await supabase
    .from("orders")
    .select("id,order_no,status")
    .eq("id", orderId)
    .eq("assigned_technician_id", technicianId)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_NOT_FOUND",
      "The requested assigned job was not found.",
      404,
    );
  }
  return asRecord(data);
}

function mapEvidence(value: unknown, viewUrl: string | null = null): TechnicianEvidenceItem {
  const evidence = asRecord(value);
  return {
    id: text(evidence.id),
    orderId: text(evidence.order_id),
    originalFilename: text(evidence.original_filename),
    mimeType: text(evidence.mime_type) as TechnicianEvidenceItem["mimeType"],
    sizeBytes: Number(evidence.size_bytes),
    status: text(evidence.status) as EvidenceUploadStatus,
    createdAt: text(evidence.created_at),
    uploadedAt: nullableText(evidence.uploaded_at),
    failureCode: nullableText(evidence.failure_code),
    viewUrl,
  };
}

async function getEvidenceRecord(
  context: CompletionContext,
  orderId: string,
  evidenceId: string,
) {
  const { data, error } = await context.supabase
    .from("service_evidence_uploads")
    .select(
      "id,order_id,technician_id,upload_request_key,storage_bucket,storage_path,original_filename,mime_type,size_bytes,status,failure_code,uploaded_at,created_at",
    )
    .eq("id", evidenceId)
    .eq("order_id", orderId)
    .eq("technician_id", context.technicianId)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_NOT_FOUND",
      "The requested evidence item was not found.",
      404,
    );
  }
  return asRecord(data);
}

async function markEvidence(
  context: CompletionContext,
  orderId: string,
  evidenceId: string,
  targetStatus: "FAILED" | "ORPHANED" | "DELETING" | "DELETED",
  failureCode: string | null,
) {
  const { error } = await context.supabase.rpc("technician_mark_evidence_upload", {
    p_actor_profile_id: context.identity.profileId,
    p_order_id: orderId,
    p_upload_id: evidenceId,
    p_target_status: targetStatus,
    p_failure_code: failureCode,
  });
  if (error) throwDataError(error);
}

async function cleanupEvidenceObject(
  context: CompletionContext,
  evidence: DataRecord,
  failureCode: string,
) {
  const bucket = text(evidence.storage_bucket);
  const path = text(evidence.storage_path);
  const { error: cleanupError } = await context.supabase.storage.from(bucket).remove([path]);
  const targetStatus = cleanupError ? "ORPHANED" : "FAILED";
  await markEvidence(
    context,
    text(evidence.order_id),
    text(evidence.id),
    targetStatus,
    failureCode,
  );
  return targetStatus;
}

export async function reserveTechnicianEvidence(
  orderId: string,
  input: ReserveEvidenceUploadInput,
): Promise<EvidenceReservationResponse> {
  const context = await createCompletionContext("evidence:upload");
  const { data, error } = await context.supabase.rpc(
    "technician_reserve_evidence_upload",
    {
      p_actor_profile_id: context.identity.profileId,
      p_order_id: orderId,
      p_original_filename: input.originalFilename,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_request_key: input.requestKey,
    },
  );
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const evidence = await getEvidenceRecord(context, orderId, text(result.upload_id));
  if (text(result.upload_status) !== "RESERVED") {
    return { evidence: mapEvidence(evidence), upload: null };
  }
  const { data: authorization, error: storageError } = await context.supabase.storage
    .from(TECHNICIAN_EVIDENCE_POLICY.bucket)
    .createSignedUploadUrl(text(result.storage_path), { upsert: true });
  if (storageError || !authorization) {
    try {
      await markEvidence(
        context,
        orderId,
        text(result.upload_id),
        "FAILED",
        "SIGNED_UPLOAD_AUTHORIZATION_FAILED",
      );
    } catch (markError) {
      throw new TechnicianCompletionError(
        "TECHNICIAN_COMPLETION_DATA_ACCESS_FAILED",
        "Upload preparation failed and the reservation could not be released. Retry with the same request key.",
        503,
        { cause: markError },
      );
    }
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_STORAGE_FAILED",
      "The evidence upload could not be prepared. Retry with the same request key.",
      502,
      { cause: storageError ?? undefined },
    );
  }
  return {
    evidence: mapEvidence(evidence),
    upload: {
      bucket: TECHNICIAN_EVIDENCE_POLICY.bucket,
      path: authorization.path,
      token: authorization.token,
    },
  };
}

async function inspectActualStorageObject(
  context: CompletionContext,
  bucket: string,
  path: string,
) {
  const lastSlash = path.lastIndexOf("/");
  const folder = path.slice(0, lastSlash);
  const filename = path.slice(lastSlash + 1);
  const { data, error } = await context.supabase.storage.from(bucket).list(folder, {
    limit: 10,
    search: filename,
  });
  if (error) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_STORAGE_FAILED",
      "The uploaded evidence could not be verified. Retry confirmation.",
      502,
      { cause: error },
    );
  }
  const file = data?.find((candidate) => candidate.name === filename);
  if (!file) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_STORAGE_FAILED",
      "The uploaded evidence object was not found. Upload the file again.",
      502,
    );
  }
  const metadata = asRecord(file.metadata);
  return normalizeStorageObjectMetadata(metadata);
}

export async function confirmTechnicianEvidence(
  orderId: string,
  evidenceId: string,
  input: ConfirmEvidenceUploadInput,
) {
  const context = await createCompletionContext("evidence:upload");
  await requireAssignedOrder(context.supabase, context.technicianId, orderId);
  const evidence = await getEvidenceRecord(context, orderId, evidenceId);
  if (text(evidence.upload_request_key) !== input.requestKey) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_CONFLICT",
      "The upload request key does not match this evidence item.",
      409,
    );
  }
  if (["UPLOADED", "ATTACHED"].includes(text(evidence.status))) {
    return { evidence: mapEvidence(evidence) };
  }
  if (text(evidence.status) !== "RESERVED") {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_CONFLICT",
      "This evidence reservation cannot be confirmed. Retry it as a new upload.",
      409,
    );
  }

  const actual = await inspectActualStorageObject(
    context,
    text(evidence.storage_bucket),
    text(evidence.storage_path),
  );
  if (
    actual.mimeType !== text(evidence.mime_type) ||
    actual.sizeBytes !== Number(evidence.size_bytes)
  ) {
    await cleanupEvidenceObject(context, evidence, "STORAGE_METADATA_MISMATCH");
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_VALIDATION_FAILED",
      "The uploaded object does not match the reserved file metadata.",
      400,
    );
  }

  const { error } = await context.supabase.rpc("technician_confirm_evidence_upload", {
    p_actor_profile_id: context.identity.profileId,
    p_order_id: orderId,
    p_upload_id: evidenceId,
    p_request_key: input.requestKey,
    p_actual_mime_type: actual.mimeType,
    p_actual_size_bytes: actual.sizeBytes,
  });
  if (error) {
    let refreshed: DataRecord;
    try {
      refreshed = await getEvidenceRecord(context, orderId, evidenceId);
    } catch {
      // An ambiguous read after an ambiguous RPC outcome must preserve the
      // private object and RESERVED row so the same request key can be retried.
      throwDataError(error);
    }
    if (["UPLOADED", "ATTACHED"].includes(text(refreshed.status))) {
      return { evidence: mapEvidence(refreshed) };
    }
    if (text(refreshed.status) === "RESERVED") {
      await cleanupEvidenceObject(context, refreshed, "METADATA_FINALIZATION_FAILED");
    }
    throwDataError(error);
  }
  return { evidence: mapEvidence(await getEvidenceRecord(context, orderId, evidenceId)) };
}

export async function listTechnicianEvidence(orderId: string) {
  const context = await createCompletionContext("job:view_assigned");
  await requireAssignedOrder(context.supabase, context.technicianId, orderId);
  const { data, error } = await context.supabase
    .from("service_evidence_uploads")
    .select(
      "id,order_id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,status,failure_code,uploaded_at,created_at",
    )
    .eq("order_id", orderId)
    .eq("technician_id", context.technicianId)
    .neq("status", "DELETED")
    .order("created_at");
  if (error) throwDataError(error);
  const evidence = await Promise.all(
    (data ?? []).map(async (value) => {
      const row = asRecord(value);
      if (!["UPLOADED", "ATTACHED"].includes(text(row.status))) return mapEvidence(row);
      const { data: signed, error: signedError } = await context.supabase.storage
        .from(text(row.storage_bucket))
        .createSignedUrl(text(row.storage_path), 300);
      return mapEvidence(row, signedError ? null : (signed?.signedUrl ?? null));
    }),
  );
  return { evidence };
}

export async function deleteTechnicianEvidence(orderId: string, evidenceId: string) {
  const context = await createCompletionContext("evidence:upload");
  const order = await requireAssignedOrder(context.supabase, context.technicianId, orderId);
  if (text(order.status) !== "IN_PROGRESS") {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_CONFLICT",
      "Evidence can only be removed while the job is in progress.",
      409,
    );
  }
  const evidence = await getEvidenceRecord(context, orderId, evidenceId);
  if (text(evidence.status) === "ATTACHED") {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_CONFLICT",
      "Completed-job evidence cannot be removed.",
      409,
    );
  }
  if (text(evidence.status) === "DELETED") return;
  await markEvidence(context, orderId, evidenceId, "DELETING", null);
  const { error } = await context.supabase.storage
    .from(text(evidence.storage_bucket))
    .remove([text(evidence.storage_path)]);
  if (error) {
    await markEvidence(context, orderId, evidenceId, "ORPHANED", "DELETE_FAILED");
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_STORAGE_FAILED",
      "The evidence object could not be removed and was marked for cleanup.",
      502,
      { cause: error },
    );
  }
  await markEvidence(context, orderId, evidenceId, "DELETED", null);
}

export async function completeTechnicianJob(
  orderId: string,
  input: CompleteTechnicianJobInput,
): Promise<TechnicianCompletionResponse> {
  const context = await createCompletionContext("job:complete_assigned");
  if (input.payment) {
    requirePermission(context.identity.role, "payment:record");
  }
  const { data, error } = await context.supabase.rpc("technician_complete_job", {
    p_actor_profile_id: context.identity.profileId,
    p_order_id: orderId,
    p_work_done: input.workDone,
    p_extra_charges: input.extraCharges,
    p_remarks: input.remarks ?? null,
    p_payment_amount: input.payment?.amount ?? null,
    p_payment_method: input.payment?.method ?? null,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const [orderResult, reportResult, attachmentResult, paymentResult] = await Promise.all([
    context.supabase
      .from("orders")
      .select("id,order_no,status")
      .eq("id", orderId)
      .eq("assigned_technician_id", context.technicianId)
      .single(),
    context.supabase
      .from("service_reports")
      .select(
        "id,work_done,extra_charges,quoted_price_snapshot,final_amount,remarks,started_at,completed_at",
      )
      .eq("id", text(result.service_report_id))
      .single(),
    context.supabase
      .from("service_evidence_uploads")
      .select(
        "id,order_id,original_filename,mime_type,size_bytes,status,failure_code,uploaded_at,created_at",
      )
      .eq("order_id", orderId)
      .eq("status", "ATTACHED")
      .order("created_at"),
    result.payment_id
      ? context.supabase
          .from("payments")
          .select("id,amount,method,recorded_at")
          .eq("id", text(result.payment_id))
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (orderResult.error) throwDataError(orderResult.error);
  if (reportResult.error) throwDataError(reportResult.error);
  if (attachmentResult.error) throwDataError(attachmentResult.error);
  if (paymentResult.error) throwDataError(paymentResult.error);
  const order = asRecord(orderResult.data);
  const reportRow = asRecord(reportResult.data);
  const report: TechnicianCompletionReport = {
    id: text(reportRow.id),
    workDone: text(reportRow.work_done),
    extraCharges: Number(reportRow.extra_charges),
    quotedPriceSnapshot: Number(reportRow.quoted_price_snapshot),
    finalAmount: Number(reportRow.final_amount),
    remarks: nullableText(reportRow.remarks),
    startedAt: nullableText(reportRow.started_at),
    completedAt: text(reportRow.completed_at),
  };
  const payment: TechnicianCompletionPayment | null = paymentResult.data
    ? (() => {
        const row = asRecord(paymentResult.data);
        return {
          id: text(row.id),
          amount: Number(row.amount),
          method: text(row.method) as TechnicianCompletionPayment["method"],
          recordedAt: text(row.recorded_at),
        };
      })()
    : null;
  return {
    job: { id: text(order.id), orderNo: text(order.order_no), status: "JOB_DONE" },
    report,
    attachments: (attachmentResult.data ?? []).map((item) => mapEvidence(item)),
    payment,
  };
}
