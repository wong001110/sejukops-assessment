import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateTechnicianRescheduleRequestInput,
  StartTechnicianJobInput,
  TechnicianInternalNotification,
  TechnicianJobAuditEvent,
  TechnicianJobDetail,
  TechnicianJobListItem,
  TechnicianJobReschedule,
  TechnicianRescheduleRequest,
} from "@/domain/technician-jobs/contracts";
import { TechnicianJobError } from "@/domain/technician-jobs/errors";
import type { AppPermission } from "@/lib/auth/permissions";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

const JOB_SELECT = `
  id,
  order_no,
  status,
  problem_description,
  service_type,
  quoted_price,
  admin_notes,
  scheduled_at,
  created_at,
  updated_at,
  customer:customers!orders_customer_id_fkey(name,phone,address),
  branch:branches!orders_branch_id_fkey(id,code,name)
`;

type DataRecord = Record<string, unknown>;

function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_DATA_ACCESS_FAILED",
      "Job data could not be read.",
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

function addressSummary(address: string): string {
  return address.length <= 90 ? address : `${address.slice(0, 87)}...`;
}

function mapTechnicianJob(value: unknown): TechnicianJobDetail {
  const order = asRecord(value);
  const customer = relation(order.customer);
  const branch = relation(order.branch);
  const customerAddress = text(customer.address);
  return {
    id: text(order.id),
    orderNo: text(order.order_no),
    status: text(order.status) as TechnicianJobDetail["status"],
    customerName: text(customer.name),
    customerPhone: text(customer.phone),
    customerAddress,
    addressSummary: addressSummary(customerAddress),
    branch: {
      id: text(branch.id),
      code: text(branch.code),
      name: text(branch.name),
    },
    problemDescription: text(order.problem_description),
    serviceType: text(order.service_type),
    quotedPrice: Number(order.quoted_price),
    adminNotes: nullableText(order.admin_notes),
    scheduledAt: nullableText(order.scheduled_at),
    createdAt: text(order.created_at),
    updatedAt: text(order.updated_at),
  };
}

function normalizeRpcRow(value: unknown): DataRecord {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new TechnicianJobError(
        "TECHNICIAN_JOB_DATA_ACCESS_FAILED",
        "The job operation returned no result.",
        503,
      );
    }
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function throwDataError(error: { message: string; code?: string } | null): never {
  const message = error?.message ?? "Unknown data error";
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("JOB_NOT_STARTABLE") ||
    message.includes("JOB_NOT_RESCHEDULABLE") ||
    message.includes("PENDING_REQUEST_EXISTS")
  ) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_CONFLICT",
      "The job changed or already has a pending request. Refresh and try again.",
      409,
    );
  }
  if (message.includes("JOB_NOT_ASSIGNED")) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_NOT_ASSIGNED",
      "This job is not assigned to the current Technician.",
      403,
    );
  }
  if (message.includes("INVALID_TECHNICIAN_ACTOR")) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_PERMISSION_DENIED",
      "An active Technician session is required.",
      403,
    );
  }
  if (message.includes("RESCHEDULE_REASON_REQUIRED")) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_VALIDATION_FAILED",
      "A reschedule reason is required.",
      400,
    );
  }
  if (error?.code === "PGRST116" || message.includes("JOB_NOT_FOUND")) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_NOT_FOUND",
      "The requested job was not found.",
      404,
    );
  }
  throw new TechnicianJobError(
    "TECHNICIAN_JOB_DATA_ACCESS_FAILED",
    "Job data is temporarily unavailable. Please try again.",
    503,
    { cause: error ?? undefined },
  );
}

async function createTechnicianContext(permission: AppPermission) {
  const context = await createAuthorizedDataContext(permission);
  if (context.identity.role !== "TECHNICIAN") {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_PERMISSION_DENIED",
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
  const linkedProfile = technician ? relation(technician.profile) : null;
  if (
    !technician ||
    linkedProfile?.active !== true ||
    linkedProfile.role !== "TECHNICIAN"
  ) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_PERMISSION_DENIED",
      "The Technician profile is inactive or unavailable.",
      403,
    );
  }
  return { ...context, technicianId: text(technician.id) };
}

async function getAssignedActiveJob(
  supabase: SupabaseClient,
  technicianId: string,
  orderId: string,
): Promise<TechnicianJobDetail> {
  const { data, error } = await supabase
    .from("orders")
    .select(JOB_SELECT)
    .eq("id", orderId)
    .eq("assigned_technician_id", technicianId)
    .in("status", ["ASSIGNED", "IN_PROGRESS"])
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) {
    throw new TechnicianJobError(
      "TECHNICIAN_JOB_NOT_FOUND",
      "The requested assigned job was not found.",
      404,
    );
  }
  return mapTechnicianJob(data);
}

export async function listTechnicianJobs(): Promise<{
  jobs: TechnicianJobListItem[];
}> {
  const { supabase, technicianId } = await createTechnicianContext("job:view_assigned");
  const { data, error } = await supabase
    .from("orders")
    .select(JOB_SELECT)
    .eq("assigned_technician_id", technicianId)
    .in("status", ["ASSIGNED", "IN_PROGRESS"])
    .limit(100);
  if (error) throwDataError(error);
  const jobs = (data ?? []).map(mapTechnicianJob).sort((left, right) => {
    const statusDifference =
      (left.status === "IN_PROGRESS" ? 0 : 1) -
      (right.status === "IN_PROGRESS" ? 0 : 1);
    if (statusDifference !== 0) return statusDifference;
    const leftSchedule = left.scheduledAt ? Date.parse(left.scheduledAt) : Number.MAX_VALUE;
    const rightSchedule = right.scheduledAt ? Date.parse(right.scheduledAt) : Number.MAX_VALUE;
    if (leftSchedule !== rightSchedule) return leftSchedule - rightSchedule;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
  return { jobs };
}

export async function getTechnicianJobDetail(orderId: string) {
  const { identity, supabase, technicianId } =
    await createTechnicianContext("job:view_assigned");
  const job = await getAssignedActiveJob(supabase, technicianId, orderId);
  const [auditResult, rescheduleResult, requestResult, notificationResult] =
    await Promise.all([
      supabase
        .from("audit_logs")
        .select(
          "id,event_type,metadata_json,created_at,actor:profiles!audit_logs_actor_profile_id_fkey(display_name)",
        )
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_reschedules")
        .select("id,previous_schedule,new_schedule,reason,source,same_day,created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_reschedule_requests")
        .select(
          "id,order_id,requested_schedule,reason,status,resolution_note,created_at,resolved_at",
        )
        .eq("order_id", orderId)
        .eq("requested_by", identity.profileId)
        .order("created_at", { ascending: false }),
      supabase
        .from("internal_notifications")
        .select("id,title,message,status,created_at,read_at")
        .eq("order_id", orderId)
        .eq("recipient_profile_id", identity.profileId)
        .order("created_at", { ascending: false }),
    ]);
  if (auditResult.error) throwDataError(auditResult.error);
  if (rescheduleResult.error) throwDataError(rescheduleResult.error);
  if (requestResult.error) throwDataError(requestResult.error);
  if (notificationResult.error) throwDataError(notificationResult.error);

  const auditEvents: TechnicianJobAuditEvent[] = (auditResult.data ?? []).map((value) => {
    const event = asRecord(value);
    const actor = optionalRelation(event.actor);
    return {
      id: text(event.id),
      eventType: text(event.event_type),
      actorName: actor ? text(actor.display_name) : null,
      metadata: asRecord(event.metadata_json),
      createdAt: text(event.created_at),
    };
  });
  const reschedules: TechnicianJobReschedule[] = (rescheduleResult.data ?? []).map(
    (value) => {
      const event = asRecord(value);
      return {
        id: text(event.id),
        previousSchedule: nullableText(event.previous_schedule),
        newSchedule: text(event.new_schedule),
        reason: nullableText(event.reason),
        source: text(event.source) as TechnicianJobReschedule["source"],
        sameDay: Boolean(event.same_day),
        createdAt: text(event.created_at),
      };
    },
  );
  const rescheduleRequests: TechnicianRescheduleRequest[] = (requestResult.data ?? []).map(
    (value) => {
      const request = asRecord(value);
      return {
        id: text(request.id),
        orderId: text(request.order_id),
        requestedSchedule: nullableText(request.requested_schedule),
        reason: text(request.reason),
        status: text(request.status) as TechnicianRescheduleRequest["status"],
        resolutionNote: nullableText(request.resolution_note),
        createdAt: text(request.created_at),
        resolvedAt: nullableText(request.resolved_at),
      };
    },
  );
  const notifications: TechnicianInternalNotification[] = (notificationResult.data ?? []).map(
    (value) => {
      const notification = asRecord(value);
      return {
        id: text(notification.id),
        title: text(notification.title),
        message: text(notification.message),
        status: text(notification.status) as TechnicianInternalNotification["status"],
        createdAt: text(notification.created_at),
        readAt: nullableText(notification.read_at),
      };
    },
  );
  return { job, auditEvents, reschedules, rescheduleRequests, notifications };
}

export async function startTechnicianJob(
  orderId: string,
  input: StartTechnicianJobInput,
) {
  const { identity, supabase, technicianId } =
    await createTechnicianContext("job:start_assigned");
  const { data, error } = await supabase.rpc("technician_start_job", {
    p_actor_profile_id: identity.profileId,
    p_order_id: orderId,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const job = await getAssignedActiveJob(supabase, technicianId, orderId);
  return { job, startedAt: text(result.started_at) };
}

export async function requestTechnicianJobReschedule(
  orderId: string,
  input: CreateTechnicianRescheduleRequestInput,
) {
  const { identity, supabase, technicianId } =
    await createTechnicianContext("job:request_reschedule");
  const { data, error } = await supabase.rpc("technician_request_reschedule", {
    p_actor_profile_id: identity.profileId,
    p_order_id: orderId,
    p_requested_schedule: input.requestedSchedule ?? null,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const requestId = text(result.reschedule_request_id);
  await getAssignedActiveJob(supabase, technicianId, orderId);
  const { data: requestData, error: requestError } = await supabase
    .from("order_reschedule_requests")
    .select(
      "id,order_id,requested_schedule,reason,status,resolution_note,created_at,resolved_at",
    )
    .eq("id", requestId)
    .eq("requested_by", identity.profileId)
    .maybeSingle();
  if (requestError) throwDataError(requestError);
  if (!requestData) throwDataError(null);
  const request = asRecord(requestData);
  return {
    request: {
      id: text(request.id),
      orderId: text(request.order_id),
      requestedSchedule: nullableText(request.requested_schedule),
      reason: text(request.reason),
      status: text(request.status) as TechnicianRescheduleRequest["status"],
      resolutionNote: nullableText(request.resolution_note),
      createdAt: text(request.created_at),
      resolvedAt: nullableText(request.resolved_at),
    } satisfies TechnicianRescheduleRequest,
  };
}
