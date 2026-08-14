"use client";

import type {
  ManagerBranch,
  ManagerPaginationMeta,
  ManagerRescheduleRequest,
  ManagerReviewFilterQuery,
  ManagerReviewListItem,
  ManagerReviewListQuery,
} from "@/domain/manager-review/contracts";

export type ReviewListResponse = {
  reviews: ManagerReviewListItem[];
  pagination: ManagerPaginationMeta;
  pendingRescheduleRequests: ManagerRescheduleRequest[];
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null) as { error?: string | { message?: string }; message?: string } | T | null;
  if (!response.ok) {
    const error = body as { error?: string | { message?: string }; message?: string } | null;
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

export const managerReviewListApi = {
  list(query: ManagerReviewListQuery) {
    return request<ReviewListResponse>(`/api/manager/reviews?${params(query)}`);
  },
  filters(query: ManagerReviewFilterQuery) {
    return request<{ options: ManagerBranch[] }>(`/api/manager/reviews/filters?${params(query)}`);
  },
};
