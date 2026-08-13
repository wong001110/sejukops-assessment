import "server-only";

import type {
  AdminOrderFilterQuery,
  AdminOrderListQuery,
  AdminOrderStatusSummary,
  AdminTechnicianOption,
  PaginationMeta,
} from "@/domain/admin-orders/contracts";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/operations";
import { listAdminOrders } from "./service";

function pageMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

export async function listAdminOrdersPaged(query: AdminOrderListQuery) {
  const result = await listAdminOrders(query);
  const start = (query.page - 1) * query.pageSize;
  return {
    orders: result.orders.slice(start, start + query.pageSize),
    pagination: pageMeta(query.page, query.pageSize, result.orders.length),
  };
}

export async function getAdminOrderFilterData(query: AdminOrderFilterQuery) {
  const result = await listAdminOrders({
    search: query.kind === "statusSummary" ? query.search : undefined,
    branchId: query.kind === "statusSummary" ? query.branchId : undefined,
    technicianId: query.kind === "statusSummary" ? query.technicianId : undefined,
    page: 1,
    pageSize: 100,
  });

  if (query.kind === "branches") {
    const q = query.q?.toLocaleLowerCase("en-MY");
    const options = result.filters.branches.filter((item) =>
      !q || item.code.toLocaleLowerCase("en-MY").includes(q) || item.name.toLocaleLowerCase("en-MY").includes(q),
    );
    const selected = query.selectedId
      ? result.filters.branches.find((item) => item.id === query.selectedId)
      : undefined;
    return { kind: query.kind, options: selected && !options.some((item) => item.id === selected.id) ? [selected, ...options].slice(0, 20) : options.slice(0, 20) } as const;
  }

  if (query.kind === "technicians") {
    const q = query.q?.toLocaleLowerCase("en-MY");
    const candidates = result.filters.technicians.filter((item) => !query.branchId || item.branchId === query.branchId);
    const options = candidates.filter((item) =>
      !q || item.name.toLocaleLowerCase("en-MY").includes(q) || item.branchCode.toLocaleLowerCase("en-MY").includes(q),
    );
    const selected = query.selectedId ? candidates.find((item) => item.id === query.selectedId) : undefined;
    const merged: AdminTechnicianOption[] = selected && !options.some((item) => item.id === selected.id) ? [selected, ...options] : options;
    return { kind: query.kind, options: merged.slice(0, 20) } as const;
  }

  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
  for (const order of result.orders) counts[order.status] += 1;
  const summary: AdminOrderStatusSummary = { total: result.orders.length, counts };
  return { kind: query.kind, summary } as const;
}
