"use client";

import type {
  ManagerReviewDetail,
  ManagerReviewListItem,
  ManagerReviewDecisionInput,
  ManagerReviewDecisionResponse,
  ManagerReviewListQuery,
  ManagerRescheduleRequest,
} from "@/domain/manager-review/contracts";
import type {
  DirectRescheduleInput,
  ResolveRescheduleRequestInput,
} from "@/domain/admin-orders/contracts";

export type ReviewQueueResponse = Readonly<{
  reviews: ManagerReviewListItem[];
  filters: Readonly<{ branches: Array<{ id: string; code: string; name: string }> }>;
  pendingRescheduleRequests: ManagerRescheduleRequest[];
}>;

export class ManagerReviewApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ManagerReviewApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; message?: string; error?: string | { message?: string } }
    | null;
  const nestedError = typeof payload?.error === "object" ? payload.error.message : payload?.error;
  if (!response.ok) {
    throw new ManagerReviewApiError(
      payload?.message ?? nestedError ?? "The request could not be completed.",
      response.status,
    );
  }
  return (payload?.data ?? payload) as T;
}

export const managerReviewApi = {
  list: (filters: ManagerReviewListQuery = {}) => {
    const query = new URLSearchParams();
    if (filters.branchId) query.set("branchId", filters.branchId);
    if (filters.search) query.set("search", filters.search);
    return request<ReviewQueueResponse>(`/api/manager/reviews${query.size ? `?${query}` : ""}`);
  },
  detail: (orderId: string) => request<{ review: ManagerReviewDetail }>(`/api/manager/reviews/${orderId}`),
  decide: (orderId: string, input: ManagerReviewDecisionInput) =>
    request<ManagerReviewDecisionResponse>(`/api/manager/reviews/${orderId}/decision`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  reschedule: (orderId: string, input: DirectRescheduleInput) =>
    request<unknown>(`/api/manager/orders/${orderId}/reschedule`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resolveRequest: (requestId: string, input: ResolveRescheduleRequestInput) =>
    request<{ request: ManagerRescheduleRequest }>(`/api/manager/reschedule-requests/${requestId}/resolve`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
