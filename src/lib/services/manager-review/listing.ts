import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ManagerBranch,
  ManagerPaginationMeta,
  ManagerRescheduleRequest,
  ManagerReviewFilterQuery,
  ManagerReviewListItem,
  ManagerReviewListQuery,
  ManagerTechnician,
} from "@/domain/manager-review/contracts";
import { ManagerReviewError } from "@/domain/manager-review/errors";
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

function pageMeta(page: number, pageSize: number, total: number): ManagerPaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}
function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as DataRecord;
}
function relation(value: unknown): DataRecord {
  return asRecord(Array.isArray(value) ? value[0] : value);
}
function optionalRelation(value: unknown): DataRecord | null {
  return value === null || value === undefined ? null : relation(value);
}
function text(value: unknown): string { return typeof value === "string" ? value : String(value ?? ""); }
function nullableText(value: unknown): string | null { return value === null || value === undefined ? null : text(value); }
function fail(cause?: unknown): never {
  throw new ManagerReviewError(
    "MANAGER_REVIEW_DATA_ACCESS_FAILED",
    "Manager review data is temporarily unavailable.",
    503,
    cause instanceof Error ? { cause } : undefined,
  );
}
async function managerSupabase(): Promise<SupabaseClient> {
  const context = await createAuthorizedDataContext("review:view");
  if (context.identity.role !== "MANAGER") {
    throw new ManagerReviewError("MANAGER_REVIEW_PERMISSION_DENIED", "An active Manager session is required.", 403);
  }
  return context.supabase;
}
function ids(rows: unknown[] | null | undefined, key = "id") {
  return (rows ?? []).map((row) => row && typeof row === "object" ? Reflect.get(row, key) : undefined).filter((value): value is string => typeof value === "string");
}

async function resolveSearchOrderIds(supabase: SupabaseClient, search?: string): Promise<string[] | null> {
  const term = search?.trim();
  if (!term) return null;
  const pattern = `%${term}%`;
  const [orderNo, serviceType, customerName, customerPhone, profileName] = await Promise.all([
    supabase.from("orders").select("id").ilike("order_no", pattern).limit(500),
    supabase.from("orders").select("id").ilike("service_type", pattern).limit(500),
    supabase.from("customers").select("id").ilike("name", pattern).limit(500),
    supabase.from("customers").select("id").ilike("phone", pattern).limit(500),
    supabase.from("profiles").select("id").ilike("display_name", pattern).limit(500),
  ]);
  for (const result of [orderNo, serviceType, customerName, customerPhone, profileName]) if (result.error) fail(result.error);
  const customerIds = [...new Set([...ids(customerName.data), ...ids(customerPhone.data)])];
  const profileIds = ids(profileName.data);
  const [customerOrders, technicians] = await Promise.all([
    customerIds.length ? supabase.from("orders").select("id").in("customer_id", customerIds).limit(500) : Promise.resolve({ data: [], error: null }),
    profileIds.length ? supabase.from("technicians").select("id").in("profile_id", profileIds).limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerOrders.error) fail(customerOrders.error);
  if (technicians.error) fail(technicians.error);
  const technicianIds = ids(technicians.data);
  const technicianOrders = technicianIds.length ? await supabase.from("orders").select("id").in("assigned_technician_id", technicianIds).limit(500) : { data: [], error: null };
  if (technicianOrders.error) fail(technicianOrders.error);
  return [...new Set([...ids(orderNo.data), ...ids(serviceType.data), ...ids(customerOrders.data), ...ids(technicianOrders.data)])].slice(0, 1000);
}

function mapBranch(value: unknown): ManagerBranch {
  const branch = relation(value);
  return { id: text(branch.id), code: text(branch.code), name: text(branch.name) };
}
function mapTechnician(value: unknown): ManagerTechnician | null {
  const technician = optionalRelation(value);
  if (!technician) return null;
  return { id: text(technician.id), name: text(relation(technician.profile).display_name) };
}

async function loadQueueFacts(supabase: SupabaseClient, orderIds: string[]) {
  if (!orderIds.length) return { reports: [] as DataRecord[], attachments: [] as DataRecord[], payments: [] as DataRecord[], flags: [] as DataRecord[], notifications: [] as DataRecord[] };
  const [reports, attachments, payments, flags, notifications] = await Promise.all([
    supabase.from("service_reports").select("id,order_id,extra_charges,final_amount,completed_at,completion_revision").in("order_id", orderIds),
    supabase.from("service_reports").select("order_id,service_attachments(id)").in("order_id", orderIds),
    supabase.from("payments").select("id,order_id").in("order_id", orderIds),
    supabase.from("ai_flags").select("id,order_id,status,completion_revision").in("order_id", orderIds),
    supabase.from("notifications").select("id,order_id,status,business_key,generated_at").eq("channel", "WHATSAPP").like("business_key", "completion:%").order("generated_at", { ascending: false }).order("id", { ascending: false }).in("order_id", orderIds),
  ]);
  for (const result of [reports, attachments, payments, flags, notifications]) if (result.error) fail(result.error);
  return {
    reports: (reports.data ?? []).map(asRecord), attachments: (attachments.data ?? []).map(asRecord), payments: (payments.data ?? []).map(asRecord), flags: (flags.data ?? []).map(asRecord), notifications: (notifications.data ?? []).map(asRecord),
  };
}

function mapQueueItem(orderValue: unknown, facts: Awaited<ReturnType<typeof loadQueueFacts>>): ManagerReviewListItem {
  const order = asRecord(orderValue);
  const orderId = text(order.id);
  const report = facts.reports.find((row) => text(row.order_id) === orderId);
  if (!report) fail();
  const attachmentRelation = facts.attachments.find((row) => text(row.order_id) === orderId);
  const attached = attachmentRelation?.service_attachments;
  const evidenceCount = Array.isArray(attached) ? attached.length : attached ? 1 : 0;
  const notification = facts.notifications.find((row) => text(row.order_id) === orderId);
  return {
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
    openFlagCount: facts.flags.filter((row) => text(row.order_id) === orderId && text(row.status) === "OPEN" && Number(row.completion_revision) === Number(report.completion_revision)).length,
    notificationStatus: notification ? text(notification.status) as ManagerReviewListItem["notificationStatus"] : null,
  };
}

function mapRequest(value: unknown): ManagerRescheduleRequest {
  const row = asRecord(value);
  return {
    id: text(row.id), orderId: text(row.order_id), orderNo: text(relation(row.order).order_no), requestedByProfileId: text(row.requested_by), requestedByName: text(relation(row.requester).display_name), requestedSchedule: nullableText(row.requested_schedule), reason: text(row.reason), status: text(row.status) as ManagerRescheduleRequest["status"], resolvedByProfileId: nullableText(row.resolved_by), resolutionNote: nullableText(row.resolution_note), createdAt: text(row.created_at), resolvedAt: nullableText(row.resolved_at),
  };
}

export async function listManagerReviewsPaged(query: ManagerReviewListQuery) {
  const supabase = await managerSupabase();
  const searchIds = await resolveSearchOrderIds(supabase, query.search);
  const pendingRequest = supabase
    .from("order_reschedule_requests")
    .select("id,order_id,requested_by,requested_schedule,reason,status,resolved_by,resolution_note,created_at,resolved_at,requester:profiles!order_reschedule_requests_requested_by_fkey(display_name),order:orders!order_reschedule_requests_order_id_fkey(order_no)")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(100);

  if (searchIds !== null && searchIds.length === 0) {
    const requests = await pendingRequest;
    if (requests.error) fail(requests.error);
    return { reviews: [], pagination: pageMeta(query.page, query.pageSize, 0), pendingRescheduleRequests: (requests.data ?? []).map(mapRequest) };
  }

  const start = (query.page - 1) * query.pageSize;
  const end = start + query.pageSize - 1;
  let request = supabase.from("orders").select(ORDER_SELECT, { count: "exact" }).eq("status", "JOB_DONE").order("updated_at", { ascending: false });
  if (query.branchId) request = request.eq("branch_id", query.branchId);
  if (searchIds !== null) request = request.in("id", searchIds);
  const [ordersResult, requests] = await Promise.all([request.range(start, end), pendingRequest]);
  if (ordersResult.error) fail(ordersResult.error);
  if (requests.error) fail(requests.error);
  const orderRows = ordersResult.data ?? [];
  const facts = await loadQueueFacts(supabase, orderRows.map((row) => text(asRecord(row).id)));
  return {
    reviews: orderRows.map((row) => mapQueueItem(row, facts)),
    pagination: pageMeta(query.page, query.pageSize, ordersResult.count ?? 0),
    pendingRescheduleRequests: (requests.data ?? []).map(mapRequest),
  };
}

export async function getManagerReviewFilterData(query: ManagerReviewFilterQuery) {
  const supabase = await managerSupabase();
  const { data, error } = await supabase.from("branches").select("id,code,name").eq("active", true).order("code").limit(100);
  if (error) fail(error);
  const q = query.q?.toLocaleLowerCase("en-MY");
  const options: ManagerBranch[] = (data ?? []).map((row) => ({ id: row.id, code: row.code, name: row.name })).filter((item) => !q || item.code.toLocaleLowerCase("en-MY").includes(q) || item.name.toLocaleLowerCase("en-MY").includes(q));
  if (query.selectedId && !options.some((item) => item.id === query.selectedId)) {
    const selected = await supabase.from("branches").select("id,code,name").eq("id", query.selectedId).maybeSingle();
    if (selected.error) fail(selected.error);
    if (selected.data) options.unshift({ id: selected.data.id, code: selected.data.code, name: selected.data.name });
  }
  return { options: options.slice(0, 20) };
}
