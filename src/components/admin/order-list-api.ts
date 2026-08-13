"use client";

import type {
  AdminBranchOption,
  AdminOrderFilterQuery,
  AdminOrderListItem,
  AdminOrderStatusSummary,
  AdminOrderListQuery,
  AdminTechnicianOption,
  PaginationMeta,
} from "@/domain/admin-orders/contracts";

export type OrderListResponse = { orders: AdminOrderListItem[]; pagination: PaginationMeta };
export type OrderFilterResponse =
  | { kind: "branches"; options: AdminBranchOption[] }
  | { kind: "technicians"; options: AdminTechnicianOption[] }
  | { kind: "statusSummary"; summary: AdminOrderStatusSummary };

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null) as { message?: string; error?: string | { message?: string } } | T | null;
  if (!response.ok) {
    const error = body as { message?: string; error?: string | { message?: string } } | null;
    const nested = typeof error?.error === "object" ? error.error.message : error?.error;
    throw new Error(error?.message ?? nested ?? "The request could not be completed.");
  }
  return body as T;
}

function params(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.toString();
}

export const orderListApi = {
  list(query: AdminOrderListQuery) {
    return request<OrderListResponse>(`/api/admin/orders?${params(query)}`);
  },
  filters(query: AdminOrderFilterQuery) {
    return request<OrderFilterResponse>(`/api/admin/orders/filters?${params(query)}`);
  },
};
