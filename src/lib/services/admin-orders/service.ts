import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdminAuditEvent,
  AdminBranchOption,
  AdminOrderDetail,
  AdminOrderListItem,
  AdminOrderListQuery,
  AdminReschedule,
  AdminRescheduleRequest,
  AdminTechnicianOption,
  CreateAdminOrderInput,
  DirectRescheduleInput,
  OrderSubmissionSummary,
  ResolveRescheduleRequestInput,
} from "@/domain/admin-orders/contracts";
import { AdminOrderError } from "@/domain/admin-orders/errors";
import type { AppPermission } from "@/lib/auth/permissions";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

const ORDER_SELECT = `
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
  customer:customers!orders_customer_id_fkey(id,name,phone,address),
  branch:branches!orders_branch_id_fkey(id,code,name),
  technician:technicians!orders_assigned_technician_id_fkey(
    id,
    branch_id,
    branch:branches!technicians_branch_id_fkey(code),
    profile:profiles!technicians_profile_id_fkey(display_name)
  )
`;

type DataRecord = Record<string, unknown>;

function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminOrderError(
      "ADMIN_ORDER_DATA_ACCESS_FAILED",
      "Order data could not be read.",
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

function mapBranch(value: unknown): AdminBranchOption {
  const branch = relation(value);
  return {
    id: text(branch.id),
    code: text(branch.code),
    name: text(branch.name),
  };
}

function mapTechnician(
  value: unknown,
  requireActiveProfile = false,
): AdminTechnicianOption | null {
  const technician = optionalRelation(value);
  if (!technician) return null;
  const profile = relation(technician.profile);
  if (requireActiveProfile && profile.active !== true) return null;
  const branch = relation(technician.branch);
  return {
    id: text(technician.id),
    name: text(profile.display_name),
    branchId: text(technician.branch_id),
    branchCode: text(branch.code),
  };
}

export function mapAdminOrder(value: unknown): AdminOrderDetail {
  const order = asRecord(value);
  const customer = relation(order.customer);
  return {
    id: text(order.id),
    orderNo: text(order.order_no),
    status: text(order.status) as AdminOrderDetail["status"],
    customerId: text(customer.id),
    customerName: text(customer.name),
    customerPhone: text(customer.phone),
    customerAddress: text(customer.address),
    branch: mapBranch(order.branch),
    technician: mapTechnician(order.technician),
    serviceType: text(order.service_type),
    problemDescription: text(order.problem_description),
    quotedPrice: Number(order.quoted_price),
    adminNotes: nullableText(order.admin_notes),
    scheduledAt: nullableText(order.scheduled_at),
    createdAt: text(order.created_at),
    updatedAt: text(order.updated_at),
  };
}

function mapAdminOrderListItem(value: unknown): AdminOrderListItem {
  return mapAdminOrder(value);
}

function normalizeRpcRow(value: unknown): DataRecord {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new AdminOrderError(
        "ADMIN_ORDER_DATA_ACCESS_FAILED",
        "The order operation returned no result.",
        503,
      );
    }
    return asRecord(value[0]);
  }
  return asRecord(value);
}

async function createAdminContext(permission: AppPermission) {
  const context = await createAuthorizedDataContext(permission);
  if (context.identity.role !== "ADMIN") {
    throw new AdminOrderError(
      "ADMIN_ORDER_PERMISSION_DENIED",
      "This operation is available to Admin users only.",
      403,
    );
  }
  return context;
}

function throwDataError(error: { message: string; code?: string } | null): never {
  const message = error?.message ?? "Unknown data error";
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("REQUEST_ALREADY_RESOLVED") ||
    message.includes("SCHEDULE_UNCHANGED")
  ) {
    throw new AdminOrderError(
      "ADMIN_ORDER_CONFLICT",
      "The request conflicts with the latest order state. Refresh and try again.",
      409,
    );
  }
  if (
    message.includes("INVALID_BRANCH") ||
    message.includes("INVALID_TECHNICIAN") ||
    message.includes("TECHNICIAN_BRANCH_MISMATCH") ||
    message.includes("APPROVAL_REQUIRES_SCHEDULE") ||
    message.includes("INVALID_ADMIN_ACTOR")
  ) {
    throw new AdminOrderError(
      "ADMIN_ORDER_VALIDATION_FAILED",
      "The submitted order data is not valid for the selected branch or schedule.",
      400,
    );
  }
  if (
    error?.code === "PGRST116" ||
    message.includes("ORDER_NOT_FOUND") ||
    message.includes("REQUEST_NOT_FOUND") ||
    message.includes("CUSTOMER_NOT_FOUND")
  ) {
    throw new AdminOrderError(
      "ADMIN_ORDER_NOT_FOUND",
      "The requested order record was not found.",
      404,
    );
  }
  throw new AdminOrderError(
    "ADMIN_ORDER_DATA_ACCESS_FAILED",
    "Order data is temporarily unavailable. Please try again.",
    503,
    { cause: error ?? undefined },
  );
}

async function getOrderById(
  supabase: SupabaseClient,
  id: string,
): Promise<AdminOrderDetail> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) {
    throw new AdminOrderError(
      "ADMIN_ORDER_NOT_FOUND",
      "The requested order was not found.",
      404,
    );
  }
  return mapAdminOrder(data);
}

async function getFilters(supabase: SupabaseClient): Promise<{
  branches: AdminBranchOption[];
  technicians: AdminTechnicianOption[];
}> {
  const [branchResult, technicianResult] = await Promise.all([
    supabase
      .from("branches")
      .select("id,code,name")
      .eq("active", true)
      .order("code"),
    supabase
      .from("technicians")
      .select(
        "id,branch_id,branch:branches!technicians_branch_id_fkey(code),profile:profiles!technicians_profile_id_fkey(display_name,active)",
      )
      .eq("active", true),
  ]);
  if (branchResult.error) throwDataError(branchResult.error);
  if (technicianResult.error) throwDataError(technicianResult.error);
  return {
    branches: (branchResult.data ?? []).map((branch) => mapBranch(branch)),
    technicians: (technicianResult.data ?? [])
      .map((technician) => mapTechnician(technician, true))
      .filter((technician): technician is AdminTechnicianOption => Boolean(technician))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function listAdminOrders(query: AdminOrderListQuery) {
  const { supabase } = await createAdminContext("order:view");
  let request = supabase
    .from("orders")
    .select(ORDER_SELECT)
    .order("created_at", { ascending: false })
    .limit(250);

  if (query.status) request = request.eq("status", query.status);
  if (query.branchId) request = request.eq("branch_id", query.branchId);
  if (query.technicianId) {
    request = request.eq("assigned_technician_id", query.technicianId);
  }

  const [orderResult, filters] = await Promise.all([request, getFilters(supabase)]);
  if (orderResult.error) throwDataError(orderResult.error);

  const search = query.search?.toLocaleLowerCase("en-MY");
  const orders = (orderResult.data ?? [])
    .map(mapAdminOrderListItem)
    .filter((order) => {
      if (!search) return true;
      return [
        order.orderNo,
        order.customerName,
        order.customerPhone,
        order.serviceType,
        order.branch.code,
        order.technician?.name,
      ].some((candidate) => candidate?.toLocaleLowerCase("en-MY").includes(search));
    });

  return { orders, filters };
}

export async function getAdminOrderDetail(id: string) {
  const { supabase } = await createAdminContext("order:view");
  const order = await getOrderById(supabase, id);
  const [auditResult, rescheduleResult, requestResult] = await Promise.all([
    supabase
      .from("audit_logs")
      .select(
        "id,event_type,actor_profile_id,metadata_json,created_at,actor:profiles!audit_logs_actor_profile_id_fkey(display_name)",
      )
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_reschedules")
      .select(
        "id,previous_schedule,new_schedule,reason,source,source_request_id,same_day,created_at",
      )
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_reschedule_requests")
      .select(
        "id,order_id,requested_by,requested_schedule,reason,status,resolved_by,resolution_note,created_at,resolved_at,requester:profiles!order_reschedule_requests_requested_by_fkey(display_name)",
      )
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (auditResult.error) throwDataError(auditResult.error);
  if (rescheduleResult.error) throwDataError(rescheduleResult.error);
  if (requestResult.error) throwDataError(requestResult.error);

  const auditEvents: AdminAuditEvent[] = (auditResult.data ?? []).map((value) => {
    const event = asRecord(value);
    const actor = optionalRelation(event.actor);
    return {
      id: text(event.id),
      eventType: text(event.event_type),
      actorProfileId: nullableText(event.actor_profile_id),
      actorName: actor ? text(actor.display_name) : null,
      metadata: asRecord(event.metadata_json),
      createdAt: text(event.created_at),
    };
  });
  const reschedules: AdminReschedule[] = (rescheduleResult.data ?? []).map(
    (value) => {
      const event = asRecord(value);
      return {
        id: text(event.id),
        previousSchedule: nullableText(event.previous_schedule),
        newSchedule: text(event.new_schedule),
        reason: nullableText(event.reason),
        source: text(event.source) as AdminReschedule["source"],
        sourceRequestId: nullableText(event.source_request_id),
        sameDay: Boolean(event.same_day),
        createdAt: text(event.created_at),
      };
    },
  );
  const rescheduleRequests: AdminRescheduleRequest[] = (requestResult.data ?? []).map(
    (value) => {
      const request = asRecord(value);
      return {
        id: text(request.id),
        orderId: text(request.order_id),
        requestedByProfileId: text(request.requested_by),
        requestedByName: text(relation(request.requester).display_name),
        requestedSchedule: nullableText(request.requested_schedule),
        reason: text(request.reason),
        status: text(request.status) as AdminRescheduleRequest["status"],
        resolvedByProfileId: nullableText(request.resolved_by),
        resolutionNote: nullableText(request.resolution_note),
        createdAt: text(request.created_at),
        resolvedAt: nullableText(request.resolved_at),
      };
    },
  );

  return { order, auditEvents, reschedules, rescheduleRequests };
}

export async function createAdminOrder(input: CreateAdminOrderInput) {
  const { identity, supabase } = await createAdminContext("order:create");
  const { data, error } = await supabase.rpc("admin_create_order", {
    p_actor_profile_id: identity.profileId,
    p_request_key: input.requestKey,
    p_customer_id: input.customer.id ?? null,
    p_customer_name: input.customer.name,
    p_customer_phone: input.customer.phone,
    p_customer_address: input.customer.address,
    p_branch_id: input.branchId,
    p_technician_id: input.technicianId ?? null,
    p_scheduled_at: input.scheduledAt ?? null,
    p_problem_description: input.problemDescription,
    p_service_type: input.serviceType,
    p_quoted_price: input.quotedPrice,
    p_admin_notes: input.adminNotes ?? null,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const order = await getOrderById(supabase, text(result.order_id));
  const summary: OrderSubmissionSummary = {
    orderNo: order.orderNo,
    customerName: order.customerName,
    branchName: order.branch.name,
    technicianName: order.technician?.name ?? null,
    scheduledAt: order.scheduledAt,
    status: order.status,
  };
  return { order, customerReused: Boolean(result.customer_reused), summary };
}

export async function directlyRescheduleAdminOrder(
  orderId: string,
  input: DirectRescheduleInput,
) {
  const { identity, supabase } = await createAdminContext("order:reschedule");
  const { data, error } = await supabase.rpc("admin_direct_reschedule_order", {
    p_actor_profile_id: identity.profileId,
    p_order_id: orderId,
    p_new_schedule: input.scheduledAt,
    p_reason: input.reason ?? null,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const detail = await getAdminOrderDetail(orderId);
  const reschedule = detail.reschedules.find(
    (candidate) => candidate.id === text(result.reschedule_id),
  );
  if (!reschedule) throwDataError(null);
  return { order: detail.order, reschedule };
}

export async function resolveAdminRescheduleRequest(
  requestId: string,
  input: ResolveRescheduleRequestInput,
) {
  const { identity, supabase } = await createAdminContext("order:reschedule");
  const { data, error } = await supabase.rpc("admin_resolve_reschedule_request", {
    p_actor_profile_id: identity.profileId,
    p_request_id: requestId,
    p_decision: input.decision,
    p_resolution_note: input.resolutionNote ?? null,
    p_new_schedule: input.newSchedule ?? null,
    p_request_key: input.requestKey,
  });
  if (error) throwDataError(error);
  const result = normalizeRpcRow(data);
  const detail = await getAdminOrderDetail(text(result.order_id));
  const request = detail.rescheduleRequests.find((candidate) => candidate.id === requestId);
  if (!request) throwDataError(null);
  const rescheduleId = nullableText(result.reschedule_id);
  return {
    request,
    order: detail.order,
    reschedule: rescheduleId
      ? (detail.reschedules.find((candidate) => candidate.id === rescheduleId) ?? null)
      : null,
  };
}
