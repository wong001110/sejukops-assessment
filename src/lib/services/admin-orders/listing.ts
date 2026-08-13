import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminBranchOption,
  AdminOrderFilterQuery,
  AdminOrderListQuery,
  AdminOrderStatusSummary,
  AdminTechnicianOption,
  PaginationMeta,
} from "@/domain/admin-orders/contracts";
import { AdminOrderError } from "@/domain/admin-orders/errors";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/operations";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";
import { mapAdminOrder } from "./service";

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

function pageMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

function fail(cause?: unknown): never {
  throw new AdminOrderError(
    "ADMIN_ORDER_DATA_ACCESS_FAILED",
    "Order data is temporarily unavailable. Please try again.",
    503,
    cause instanceof Error ? { cause } : undefined,
  );
}

async function adminSupabase(): Promise<SupabaseClient> {
  const context = await createAuthorizedDataContext("order:view");
  if (context.identity.role !== "ADMIN") {
    throw new AdminOrderError(
      "ADMIN_ORDER_PERMISSION_DENIED",
      "An active Admin session is required.",
      403,
    );
  }
  return context.supabase;
}

function ids(rows: unknown[] | null | undefined, key = "id") {
  return (rows ?? [])
    .map((row) => row && typeof row === "object" ? Reflect.get(row, key) : undefined)
    .filter((value): value is string => typeof value === "string");
}

async function resolveSearchOrderIds(
  supabase: SupabaseClient,
  search?: string,
): Promise<string[] | null> {
  const term = search?.trim();
  if (!term) return null;
  const pattern = `%${term}%`;

  const [orderNo, serviceType, customerName, customerPhone, branchCode, branchName, profileName] =
    await Promise.all([
      supabase.from("orders").select("id").ilike("order_no", pattern).limit(500),
      supabase.from("orders").select("id").ilike("service_type", pattern).limit(500),
      supabase.from("customers").select("id").ilike("name", pattern).limit(500),
      supabase.from("customers").select("id").ilike("phone", pattern).limit(500),
      supabase.from("branches").select("id").ilike("code", pattern).limit(100),
      supabase.from("branches").select("id").ilike("name", pattern).limit(100),
      supabase.from("profiles").select("id").ilike("display_name", pattern).limit(500),
    ]);

  for (const result of [orderNo, serviceType, customerName, customerPhone, branchCode, branchName, profileName]) {
    if (result.error) fail(result.error);
  }

  const customerIds = [...new Set([...ids(customerName.data), ...ids(customerPhone.data)])];
  const branchIds = [...new Set([...ids(branchCode.data), ...ids(branchName.data)])];
  const profileIds = ids(profileName.data);

  const [customerOrders, branchOrders, matchingTechnicians] = await Promise.all([
    customerIds.length
      ? supabase.from("orders").select("id").in("customer_id", customerIds).limit(500)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? supabase.from("orders").select("id").in("branch_id", branchIds).limit(500)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? supabase.from("technicians").select("id").in("profile_id", profileIds).limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerOrders.error) fail(customerOrders.error);
  if (branchOrders.error) fail(branchOrders.error);
  if (matchingTechnicians.error) fail(matchingTechnicians.error);

  const technicianIds = ids(matchingTechnicians.data);
  const technicianOrders = technicianIds.length
    ? await supabase.from("orders").select("id").in("assigned_technician_id", technicianIds).limit(500)
    : { data: [], error: null };
  if (technicianOrders.error) fail(technicianOrders.error);

  return [...new Set([
    ...ids(orderNo.data),
    ...ids(serviceType.data),
    ...ids(customerOrders.data),
    ...ids(branchOrders.data),
    ...ids(technicianOrders.data),
  ])].slice(0, 1000);
}

function applyListFilters<T>(
  request: T,
  query: Pick<AdminOrderListQuery, "status" | "branchId" | "technicianId">,
  searchIds: string[] | null,
): T {
  let next = request as T & {
    eq: (column: string, value: string) => T;
    in: (column: string, values: string[]) => T;
  };
  if (query.status) next = next.eq("status", query.status) as typeof next;
  if (query.branchId) next = next.eq("branch_id", query.branchId) as typeof next;
  if (query.technicianId) next = next.eq("assigned_technician_id", query.technicianId) as typeof next;
  if (searchIds !== null) next = next.in("id", searchIds) as typeof next;
  return next as T;
}

export async function listAdminOrdersPaged(query: AdminOrderListQuery) {
  const supabase = await adminSupabase();
  const searchIds = await resolveSearchOrderIds(supabase, query.search);
  if (searchIds !== null && searchIds.length === 0) {
    return { orders: [], pagination: pageMeta(query.page, query.pageSize, 0) };
  }

  const start = (query.page - 1) * query.pageSize;
  const end = start + query.pageSize - 1;
  let request = supabase
    .from("orders")
    .select(ORDER_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });
  request = applyListFilters(request, query, searchIds);
  const { data, count, error } = await request.range(start, end);
  if (error) fail(error);
  const total = count ?? 0;
  return {
    orders: (data ?? []).map((row) => mapAdminOrder(row)),
    pagination: pageMeta(query.page, query.pageSize, total),
  };
}

async function branchOptions(
  supabase: SupabaseClient,
  query: AdminOrderFilterQuery,
): Promise<AdminBranchOption[]> {
  let request = supabase.from("branches").select("id,code,name").eq("active", true).order("code").limit(100);
  const { data, error } = await request;
  if (error) fail(error);
  const q = query.q?.toLocaleLowerCase("en-MY");
  const options = (data ?? [])
    .map((row) => ({ id: row.id, code: row.code, name: row.name }))
    .filter((item) => !q || item.code.toLocaleLowerCase("en-MY").includes(q) || item.name.toLocaleLowerCase("en-MY").includes(q));
  if (query.selectedId && !options.some((item) => item.id === query.selectedId)) {
    const selected = await supabase.from("branches").select("id,code,name").eq("id", query.selectedId).maybeSingle();
    if (selected.error) fail(selected.error);
    if (selected.data) options.unshift({ id: selected.data.id, code: selected.data.code, name: selected.data.name });
  }
  return options.slice(0, 20);
}

async function technicianOptions(
  supabase: SupabaseClient,
  query: AdminOrderFilterQuery,
): Promise<AdminTechnicianOption[]> {
  let request = supabase
    .from("technicians")
    .select("id,branch_id,branch:branches!technicians_branch_id_fkey(code),profile:profiles!technicians_profile_id_fkey(display_name,active)")
    .eq("active", true)
    .limit(200);
  if (query.branchId) request = request.eq("branch_id", query.branchId);
  const { data, error } = await request;
  if (error) fail(error);
  const q = query.q?.toLocaleLowerCase("en-MY");
  const options = (data ?? []).flatMap((row) => {
    const profileRaw = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    const branchRaw = Array.isArray(row.branch) ? row.branch[0] : row.branch;
    if (!profileRaw || !branchRaw || profileRaw.active !== true) return [];
    const item: AdminTechnicianOption = {
      id: row.id,
      name: profileRaw.display_name,
      branchId: row.branch_id,
      branchCode: branchRaw.code,
    };
    return !q || item.name.toLocaleLowerCase("en-MY").includes(q) || item.branchCode.toLocaleLowerCase("en-MY").includes(q)
      ? [item]
      : [];
  });

  if (query.selectedId && !options.some((item) => item.id === query.selectedId)) {
    const selected = await supabase
      .from("technicians")
      .select("id,branch_id,branch:branches!technicians_branch_id_fkey(code),profile:profiles!technicians_profile_id_fkey(display_name,active)")
      .eq("id", query.selectedId)
      .maybeSingle();
    if (selected.error) fail(selected.error);
    if (selected.data) {
      const profileRaw = Array.isArray(selected.data.profile) ? selected.data.profile[0] : selected.data.profile;
      const branchRaw = Array.isArray(selected.data.branch) ? selected.data.branch[0] : selected.data.branch;
      if (profileRaw && branchRaw) {
        options.unshift({ id: selected.data.id, name: profileRaw.display_name, branchId: selected.data.branch_id, branchCode: branchRaw.code });
      }
    }
  }
  return options.slice(0, 20);
}

async function statusSummary(
  supabase: SupabaseClient,
  query: AdminOrderFilterQuery,
): Promise<AdminOrderStatusSummary> {
  const searchIds = await resolveSearchOrderIds(supabase, query.search);
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
  if (searchIds !== null && searchIds.length === 0) return { total: 0, counts };

  const values = await Promise.all(ORDER_STATUSES.map(async (status) => {
    let request = supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", status);
    if (query.branchId) request = request.eq("branch_id", query.branchId);
    if (query.technicianId) request = request.eq("assigned_technician_id", query.technicianId);
    if (searchIds !== null) request = request.in("id", searchIds);
    const { count, error } = await request;
    if (error) fail(error);
    return [status, count ?? 0] as const;
  }));
  for (const [status, count] of values) counts[status] = count;
  return { total: Object.values(counts).reduce((sum, value) => sum + value, 0), counts };
}

export async function getAdminOrderFilterData(query: AdminOrderFilterQuery) {
  const supabase = await adminSupabase();
  if (query.kind === "branches") return { kind: query.kind, options: await branchOptions(supabase, query) } as const;
  if (query.kind === "technicians") return { kind: query.kind, options: await technicianOptions(supabase, query) } as const;
  return { kind: query.kind, summary: await statusSummary(supabase, query) } as const;
}
