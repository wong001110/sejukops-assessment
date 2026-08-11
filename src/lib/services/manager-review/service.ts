import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DirectRescheduleInput,
  ResolveRescheduleRequestInput,
} from "@/domain/admin-orders/contracts";
import type {
  ManagerAuditEvent,
  ManagerBranch,
  ManagerEvidence,
  ManagerJobReview,
  ManagerPayment,
  ManagerReschedule,
  ManagerRescheduleRequest,
  ManagerReviewDecisionInput,
  ManagerReviewDecisionResponse,
  ManagerReviewDetail,
  ManagerReviewListItem,
  ManagerReviewListQuery,
  ManagerTechnician,
  ManagerWorkflowFlag,
} from "@/domain/manager-review/contracts";
import { workflowFlagSchema } from "@/domain/workflow-supervisor/contracts";
import { ManagerReviewError } from "@/domain/manager-review/errors";
import type { AppPermission } from "@/lib/auth/permissions";
import { getCompletionWhatsApp } from "@/lib/services/completion-notifications/service";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

const ORDER_SELECT = `
  id,order_no,status,problem_description,service_type,quoted_price,admin_notes,
  scheduled_at,created_at,updated_at,
  customer:customers!orders_customer_id_fkey(id,name,phone,address),
  branch:branches!orders_branch_id_fkey(id,code,name),
  technician:technicians!orders_assigned_technician_id_fkey(
    id,profile:profiles!technicians_profile_id_fkey(display_name)
  )
`;

type DataRecord = Record<string, unknown>;

function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_DATA_ACCESS_FAILED",
      "Manager review data could not be read.",
      503,
    );
  }
  return value as DataRecord;
}

function relation(value: unknown): DataRecord {
  return asRecord(Array.isArray(value) ? value[0] : value);
}

function optionalRelation(value: unknown): DataRecord | null {
  return value === null || value === undefined ? null : relation(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function rpcRow(value: unknown): DataRecord {
  if (Array.isArray(value)) {
    if (!value[0]) throwDataError(null);
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function throwDataError(error: { message: string; code?: string } | null): never {
  const message = error?.message ?? "Unknown manager review error";
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("ORDER_NOT_REVIEWABLE") ||
    message.includes("REVIEW_REVISION_SUPERSEDED") ||
    message.includes("REQUEST_ALREADY_RESOLVED") ||
    message.includes("SCHEDULE_UNCHANGED")
  ) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_CONFLICT",
      "The record changed. Refresh before trying again.",
      409,
    );
  }
  if (
    message.includes("INVALID_REVIEW_DECISION") ||
    message.includes("CLARIFICATION_NOTE_REQUIRED") ||
    message.includes("INVALID_DECISION") ||
    message.includes("APPROVAL_REQUIRES_SCHEDULE")
  ) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_VALIDATION_FAILED",
      "The submitted review or schedule values are not valid.",
      400,
    );
  }
  if (message.includes("INVALID_MANAGER_ACTOR")) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "An active Manager session is required.",
      403,
    );
  }
  if (
    error?.code === "PGRST116" ||
    message.includes("ORDER_NOT_FOUND") ||
    message.includes("REQUEST_NOT_FOUND")
  ) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_NOT_FOUND",
      "The requested Manager record was not found.",
      404,
    );
  }
  throw new ManagerReviewError(
    "MANAGER_REVIEW_DATA_ACCESS_FAILED",
    "Manager review data is temporarily unavailable.",
    503,
    { cause: error ?? undefined },
  );
}

async function createManagerContext(permission: AppPermission) {
  const context = await createAuthorizedDataContext(permission);
  if (context.identity.role !== "MANAGER") {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "This operation is available to Manager users only.",
      403,
    );
  }
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("id,role,active")
    .eq("id", context.identity.profileId)
    .eq("role", "MANAGER")
    .eq("active", true)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!profile) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "The Manager profile is inactive or unavailable.",
      403,
    );
  }
  return context;
}

function mapBranch(value: unknown): ManagerBranch {
  const branch = relation(value);
  return { id: text(branch.id), code: text(branch.code), name: text(branch.name) };
}

function mapTechnician(value: unknown): ManagerTechnician | null {
  const technician = optionalRelation(value);
  if (!technician) return null;
  return {
    id: text(technician.id),
    name: text(relation(technician.profile).display_name),
  };
}

function mapReschedule(value: unknown): ManagerReschedule {
  const row = asRecord(value);
  return {
    id: text(row.id),
    previousSchedule: nullableText(row.previous_schedule),
    newSchedule: text(row.new_schedule),
    reason: nullableText(row.reason),
    source: text(row.source) as ManagerReschedule["source"],
    sourceRequestId: nullableText(row.source_request_id),
    sameDay: Boolean(row.same_day),
    createdAt: text(row.created_at),
  };
}

function mapRescheduleRequest(value: unknown): ManagerRescheduleRequest {
  const row = asRecord(value);
  const requester = relation(row.requester);
  const order = relation(row.order);
  return {
    id: text(row.id),
    orderId: text(row.order_id),
    orderNo: text(order.order_no),
    requestedByProfileId: text(row.requested_by),
    requestedByName: text(requester.display_name),
    requestedSchedule: nullableText(row.requested_schedule),
    reason: text(row.reason),
    status: text(row.status) as ManagerRescheduleRequest["status"],
    resolvedByProfileId: nullableText(row.resolved_by),
    resolutionNote: nullableText(row.resolution_note),
    createdAt: text(row.created_at),
    resolvedAt: nullableText(row.resolved_at),
  };
}

async function loadQueueFacts(supabase: SupabaseClient, orderIds: string[]) {
  if (orderIds.length === 0) {
    return {
      reports: [] as DataRecord[], attachments: [] as DataRecord[],
      payments: [] as DataRecord[], flags: [] as DataRecord[],
      notifications: [] as DataRecord[],
    };
  }
  const [reports, attachments, payments, flags, notifications] = await Promise.all([
    supabase
      .from("service_reports")
      .select("id,order_id,extra_charges,final_amount,completed_at,completion_revision")
      .in("order_id", orderIds),
    supabase
      .from("service_reports")
      .select("order_id,service_attachments(id)")
      .in("order_id", orderIds),
    supabase.from("payments").select("id,order_id").in("order_id", orderIds),
    supabase.from("ai_flags").select("id,order_id,status,completion_revision").in("order_id", orderIds),
    supabase
      .from("notifications")
      .select("id,order_id,status,business_key,generated_at")
      .eq("channel", "WHATSAPP")
      .like("business_key", "completion:%")
      .order("generated_at", { ascending: false })
      .order("id", { ascending: false })
      .in("order_id", orderIds),
  ]);
  for (const result of [reports, attachments, payments, flags, notifications]) {
    if (result.error) throwDataError(result.error);
  }
  return {
    reports: (reports.data ?? []).map(asRecord),
    attachments: (attachments.data ?? []).map(asRecord),
    payments: (payments.data ?? []).map(asRecord),
    flags: (flags.data ?? []).map(asRecord),
    notifications: (notifications.data ?? []).map(asRecord),
  };
}

function mapQueueItem(orderValue: unknown, facts: Awaited<ReturnType<typeof loadQueueFacts>>) {
  const order = asRecord(orderValue);
  const orderId = text(order.id);
  const report = facts.reports.find((row) => text(row.order_id) === orderId);
  if (!report) throwDataError(null);
  const attachmentRelation = facts.attachments.find(
    (row) => text(row.order_id) === orderId,
  );
  const attached = attachmentRelation?.service_attachments;
  const evidenceCount = Array.isArray(attached) ? attached.length : attached ? 1 : 0;
  const notification = facts.notifications.find((row) => text(row.order_id) === orderId);
  const item: ManagerReviewListItem = {
    id: orderId,
    orderNo: text(order.order_no),
    status: text(order.status) as ManagerReviewListItem["status"],
    customerName: text(relation(order.customer).name),
    customerPhone: text(relation(order.customer).phone),
    branch: mapBranch(order.branch),
    technician: mapTechnician(order.technician),
    serviceType: text(order.service_type),
    scheduledAt: nullableText(order.scheduled_at),
    completedAt: text(report.completed_at),
    quotedPrice: Number(order.quoted_price),
    extraCharges: Number(report.extra_charges),
    finalAmount: Number(report.final_amount),
    evidenceCount,
    hasPayment: facts.payments.some((row) => text(row.order_id) === orderId),
    openFlagCount: facts.flags.filter(
      (row) =>
        text(row.order_id) === orderId &&
        text(row.status) === "OPEN" &&
        Number(row.completion_revision) === Number(report.completion_revision),
    ).length,
    notificationStatus: notification
      ? (text(notification.status) as ManagerReviewListItem["notificationStatus"])
      : null,
  };
  return item;
}

export async function listManagerReviews(query: ManagerReviewListQuery) {
  const { supabase } = await createManagerContext("review:view");
  let ordersRequest = supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("status", "JOB_DONE")
    .order("updated_at", { ascending: false })
    .limit(250);
  if (query.branchId) ordersRequest = ordersRequest.eq("branch_id", query.branchId);
  const [ordersResult, branchesResult, requestResult] = await Promise.all([
    ordersRequest,
    supabase.from("branches").select("id,code,name").eq("active", true).order("code"),
    supabase
      .from("order_reschedule_requests")
      .select(
        "id,order_id,requested_by,requested_schedule,reason,status,resolved_by,resolution_note,created_at,resolved_at,requester:profiles!order_reschedule_requests_requested_by_fkey(display_name),order:orders!order_reschedule_requests_order_id_fkey(order_no)",
      )
      .eq("status", "PENDING")
      .order("created_at", { ascending: false }),
  ]);
  if (ordersResult.error) throwDataError(ordersResult.error);
  if (branchesResult.error) throwDataError(branchesResult.error);
  if (requestResult.error) throwDataError(requestResult.error);
  const orderRows = ordersResult.data ?? [];
  const facts = await loadQueueFacts(supabase, orderRows.map((row) => text(asRecord(row).id)));
  const search = query.search?.toLocaleLowerCase("en-MY");
  const reviews = orderRows.map((row) => mapQueueItem(row, facts)).filter((item) => {
    if (!search) return true;
    return [
      item.orderNo,
      item.customerName,
      item.customerPhone,
      item.serviceType,
      item.technician?.name,
    ]
      .some((candidate) => candidate?.toLocaleLowerCase("en-MY").includes(search));
  });
  return {
    reviews,
    filters: { branches: (branchesResult.data ?? []).map(mapBranch) },
    pendingRescheduleRequests: (requestResult.data ?? []).map(mapRescheduleRequest),
  };
}

async function getOrder(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from("orders").select(ORDER_SELECT).eq("id", orderId).maybeSingle();
  if (error) throwDataError(error);
  if (!data) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_NOT_FOUND", "The requested order was not found.", 404,
    );
  }
  return asRecord(data);
}

export async function getManagerReviewDetail(orderId: string): Promise<{
  review: ManagerReviewDetail;
}> {
  const { supabase } = await createManagerContext("review:view");
  const order = await getOrder(supabase, orderId);
  const [reportResult, paymentResult, auditResult, flagResult, reviewResult,
    rescheduleResult, requestResult] = await Promise.all([
    supabase
      .from("service_reports")
      .select("id,work_done,extra_charges,final_amount,remarks,completed_at")
      .eq("order_id", orderId).maybeSingle(),
    supabase
      .from("payments")
      .select("id,amount,method,receipt_storage_path,recorded_at")
      .eq("order_id", orderId).order("recorded_at", { ascending: false }).limit(1)
      .maybeSingle(),
    supabase
      .from("audit_logs")
      .select("id,event_type,metadata_json,created_at,actor:profiles!audit_logs_actor_profile_id_fkey(display_name)")
      .eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("ai_flags").select("id,order_id,rule_code,completion_revision,severity,title,deterministic_summary,details,status,explanation_status,explanation_summary,explanation_recommendation,explanation_error_code,explanation_generated_at,created_at")
      .eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase
      .from("job_reviews")
      .select("id,decision,note,created_at,reviewer:profiles!job_reviews_reviewed_by_fkey(display_name)")
      .eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase
      .from("order_reschedules")
      .select("id,previous_schedule,new_schedule,reason,source,source_request_id,same_day,created_at")
      .eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase
      .from("order_reschedule_requests")
      .select("id,order_id,requested_by,requested_schedule,reason,status,resolved_by,resolution_note,created_at,resolved_at,requester:profiles!order_reschedule_requests_requested_by_fkey(display_name),order:orders!order_reschedule_requests_order_id_fkey(order_no)")
      .eq("order_id", orderId).order("created_at", { ascending: false }),
  ]);
  for (const result of [reportResult, paymentResult, auditResult, flagResult,
    reviewResult, rescheduleResult, requestResult]) {
    if (result.error) throwDataError(result.error);
  }
  if (!reportResult.data) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_NOT_FOUND", "This order does not have a completion report.", 404,
    );
  }
  const report = asRecord(reportResult.data);
  const attachmentResult = await supabase
    .from("service_attachments")
    .select("id,storage_bucket,storage_path,original_filename,mime_type,size_bytes")
    .eq("service_report_id", text(report.id)).order("created_at");
  if (attachmentResult.error) throwDataError(attachmentResult.error);
  const evidence: ManagerEvidence[] = await Promise.all(
    (attachmentResult.data ?? []).map(async (value) => {
      const row = asRecord(value);
      const { data: signed, error } = await supabase.storage
        .from(text(row.storage_bucket)).createSignedUrl(text(row.storage_path), 300);
      return {
        id: text(row.id), filename: text(row.original_filename),
        mimeType: text(row.mime_type), sizeBytes: Number(row.size_bytes),
        viewUrl: error ? null : (signed?.signedUrl ?? null),
      };
    }),
  );
  let payment: ManagerPayment | null = null;
  if (paymentResult.data) {
    const row = asRecord(paymentResult.data);
    let receiptViewUrl: string | null = null;
    const receiptPath = nullableText(row.receipt_storage_path);
    if (receiptPath) {
      const { data: signed, error } = await supabase.storage
        .from("service-evidence").createSignedUrl(receiptPath, 300);
      receiptViewUrl = error ? null : (signed?.signedUrl ?? null);
    }
    payment = {
      id: text(row.id), amount: Number(row.amount), method: text(row.method),
      recordedAt: text(row.recorded_at), receiptViewUrl,
    };
  }
  const notification = await getCompletionWhatsApp(
    orderId, "review:view", ["MANAGER"],
  );
  const base: ManagerReviewListItem = {
    id: orderId,
    orderNo: text(order.order_no),
    status: text(order.status) as ManagerReviewListItem["status"],
    customerName: text(relation(order.customer).name),
    customerPhone: text(relation(order.customer).phone),
    branch: mapBranch(order.branch),
    technician: mapTechnician(order.technician),
    serviceType: text(order.service_type),
    scheduledAt: nullableText(order.scheduled_at),
    completedAt: text(report.completed_at),
    quotedPrice: Number(order.quoted_price),
    extraCharges: Number(report.extra_charges),
    finalAmount: Number(report.final_amount),
    evidenceCount: evidence.length,
    hasPayment: Boolean(payment),
    openFlagCount: (flagResult.data ?? []).filter(
      (row) => text(asRecord(row).status) === "OPEN",
    ).length,
    notificationStatus: notification?.status ?? null,
  };
  const auditEvents: ManagerAuditEvent[] = (auditResult.data ?? []).map((value) => {
    const row = asRecord(value);
    const actor = optionalRelation(row.actor);
    return {
      id: text(row.id), eventType: text(row.event_type),
      actorName: actor ? text(actor.display_name) : null,
      metadata: asRecord(row.metadata_json), createdAt: text(row.created_at),
    };
  });
  const flags: ManagerWorkflowFlag[] = (flagResult.data ?? []).map((value) => {
    const row = asRecord(value);
    return workflowFlagSchema.parse({
      id: text(row.id), orderId: text(row.order_id),
      ruleCode: text(row.rule_code), completionRevision: Number(row.completion_revision),
      severity: text(row.severity), title: text(row.title),
      deterministicSummary: text(row.deterministic_summary),
      details: asRecord(row.details), status: text(row.status),
      explanation: {
        status: text(row.explanation_status),
        summary: nullableText(row.explanation_summary),
        recommendation: nullableText(row.explanation_recommendation),
        errorCode: nullableText(row.explanation_error_code),
        generatedAt: nullableText(row.explanation_generated_at),
      },
      createdAt: text(row.created_at),
    });
  });
  const reviews: ManagerJobReview[] = (reviewResult.data ?? []).map((value) => {
    const row = asRecord(value);
    return {
      id: text(row.id), decision: text(row.decision) as ManagerJobReview["decision"],
      note: nullableText(row.note), reviewerName: text(relation(row.reviewer).display_name),
      createdAt: text(row.created_at),
    };
  });
  return {
    review: {
      ...base,
      customerAddress: text(relation(order.customer).address),
      problemDescription: text(order.problem_description),
      adminNotes: nullableText(order.admin_notes),
      workDone: text(report.work_done), remarks: nullableText(report.remarks),
      evidence, payment, auditEvents, flags, reviews,
      reschedules: (rescheduleResult.data ?? []).map(mapReschedule),
      rescheduleRequests: (requestResult.data ?? []).map(mapRescheduleRequest),
      notification,
    },
  };
}

export async function reviewManagerJob(
  orderId: string,
  input: ManagerReviewDecisionInput,
): Promise<ManagerReviewDecisionResponse> {
  const { identity, supabase } = await createManagerContext("review:approve");
  const { data, error } = await supabase.rpc("manager_review_job", {
    p_actor_profile_id: identity.profileId,
    p_order_id: orderId,
    p_decision: input.decision,
    p_note: input.note ?? null,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = rpcRow(data);
  const [orderResult, reviewResult] = await Promise.all([
    supabase.from("orders").select("id,order_no,status").eq("id", orderId).single(),
    supabase
      .from("job_reviews")
      .select("id,decision,note,created_at,reviewer:profiles!job_reviews_reviewed_by_fkey(display_name)")
      .eq("id", text(result.review_id)).single(),
  ]);
  if (orderResult.error) throwDataError(orderResult.error);
  if (reviewResult.error) throwDataError(reviewResult.error);
  const order = asRecord(orderResult.data);
  const review = asRecord(reviewResult.data);
  return {
    order: {
      id: text(order.id), orderNo: text(order.order_no),
      status: text(order.status) as "CLOSED" | "IN_PROGRESS",
    },
    review: {
      id: text(review.id),
      decision: text(review.decision) as ManagerJobReview["decision"],
      note: nullableText(review.note),
      reviewerName: text(relation(review.reviewer).display_name),
      createdAt: text(review.created_at),
    },
    replayed: Boolean(result.replayed),
  };
}

async function loadManagerRescheduleResult(
  supabase: SupabaseClient,
  orderId: string,
  rescheduleId: string | null,
  requestId?: string,
) {
  const order = await getOrder(supabase, orderId);
  const rescheduleResult = rescheduleId
    ? await supabase
        .from("order_reschedules")
        .select("id,previous_schedule,new_schedule,reason,source,source_request_id,same_day,created_at")
        .eq("id", rescheduleId).single()
    : { data: null, error: null };
  if (rescheduleResult.error) throwDataError(rescheduleResult.error);
  const requestResult = requestId
    ? await supabase
        .from("order_reschedule_requests")
        .select("id,order_id,requested_by,requested_schedule,reason,status,resolved_by,resolution_note,created_at,resolved_at,requester:profiles!order_reschedule_requests_requested_by_fkey(display_name),order:orders!order_reschedule_requests_order_id_fkey(order_no)")
        .eq("id", requestId).single()
    : { data: null, error: null };
  if (requestResult.error) throwDataError(requestResult.error);
  return {
    order: {
      id: text(order.id), orderNo: text(order.order_no),
      status: text(order.status), scheduledAt: nullableText(order.scheduled_at),
    },
    reschedule: rescheduleResult.data ? mapReschedule(rescheduleResult.data) : null,
    request: requestResult.data ? mapRescheduleRequest(requestResult.data) : null,
  };
}

export async function directlyRescheduleManagerOrder(
  orderId: string,
  input: DirectRescheduleInput,
) {
  const { identity, supabase } = await createManagerContext("order:reschedule");
  const { data, error } = await supabase.rpc("manager_direct_reschedule_order", {
    p_actor_profile_id: identity.profileId, p_order_id: orderId,
    p_new_schedule: input.scheduledAt, p_reason: input.reason ?? null,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = rpcRow(data);
  const loaded = await loadManagerRescheduleResult(
    supabase, orderId, text(result.reschedule_id),
  );
  return { order: loaded.order, reschedule: loaded.reschedule };
}

export async function resolveManagerRescheduleRequest(
  requestId: string,
  input: ResolveRescheduleRequestInput,
) {
  const { identity, supabase } = await createManagerContext("order:reschedule");
  const { data, error } = await supabase.rpc("manager_resolve_reschedule_request", {
    p_actor_profile_id: identity.profileId, p_request_id: requestId,
    p_decision: input.decision, p_resolution_note: input.resolutionNote ?? null,
    p_new_schedule: input.newSchedule ?? null, p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = rpcRow(data);
  const rescheduleId = nullableText(result.reschedule_id);
  const loaded = await loadManagerRescheduleResult(
    supabase, text(result.order_id), rescheduleId, requestId,
  );
  return { request: loaded.request, order: loaded.order, reschedule: loaded.reschedule };
}
