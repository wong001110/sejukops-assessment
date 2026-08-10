"use client";

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

// The UI consumes the browser-safe backend contract directly. Keep this file
// to transport/error concerns so route changes do not leak into components.
export type AdminOrder = AdminOrderListItem;
export type SelectOption = AdminBranchOption | AdminTechnicianOption;
export type RescheduleEvent = AdminReschedule;
export type RescheduleRequest = AdminRescheduleRequest;
export type AuditEvent = AdminAuditEvent;
export type OrderDetail = { order: AdminOrderDetail; auditEvents: AuditEvent[]; reschedules: RescheduleEvent[]; rescheduleRequests: RescheduleRequest[] };
export type OrderFilters = AdminOrderListQuery;
export type CreateOrderInput = CreateAdminOrderInput;

export class OrderApiError extends Error { constructor(message: string, readonly status?: number) { super(message); this.name = "OrderApiError"; } }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = (await response.json().catch(() => null)) as { data?: T; message?: string; error?: string | { message?: string } } | null;
  const nestedError = typeof json?.error === "object" ? json.error.message : json?.error;
  if (!response.ok) throw new OrderApiError(json?.message ?? nestedError ?? "The request could not be completed.", response.status);
  return (json?.data ?? json) as T;
}

export const orderApi = {
  list(filters: OrderFilters) { const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); }); return request<{ orders: AdminOrder[]; filters: { branches: AdminBranchOption[]; technicians: AdminTechnicianOption[] } }>(`/api/admin/orders${query.size ? `?${query}` : ""}`); },
  detail(id: string) { return request<OrderDetail>(`/api/admin/orders/${id}`); },
  create(input: CreateOrderInput) { return request<{ order: AdminOrderDetail; customerReused: boolean; summary: OrderSubmissionSummary }>("/api/admin/orders", { method: "POST", body: JSON.stringify(input) }); },
  reschedule(id: string, input: DirectRescheduleInput) { return request<{ order: AdminOrderDetail; reschedule: RescheduleEvent }>(`/api/admin/orders/${id}/reschedule`, { method: "POST", body: JSON.stringify(input) }); },
  resolveRequest(id: string, input: ResolveRescheduleRequestInput) { return request<{ order?: AdminOrderDetail; request: RescheduleRequest; reschedule?: RescheduleEvent }>(`/api/admin/reschedule-requests/${id}/resolve`, { method: "POST", body: JSON.stringify(input) }); },
};
