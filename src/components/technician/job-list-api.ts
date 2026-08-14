"use client";

import type {
  TechnicianJobHistoryItem,
  TechnicianJobListItem,
  TechnicianPaginationMeta,
} from "@/domain/technician-jobs/contracts";

export type TechnicianActivePage = {
  jobs: TechnicianJobListItem[];
  pagination: TechnicianPaginationMeta;
};
export type TechnicianHistoryPage = {
  jobs: TechnicianJobHistoryItem[];
  pagination: TechnicianPaginationMeta;
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | T | null;
  if (!response.ok) {
    throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? "The request could not be completed.");
  }
  return body as T;
}

export const technicianJobListApi = {
  active(page = 1, pageSize = 10) {
    return request<TechnicianActivePage>(`/api/technician/jobs?scope=active&page=${page}&pageSize=${pageSize}`);
  },
  history(page = 1, pageSize = 10) {
    return request<TechnicianHistoryPage>(`/api/technician/jobs?scope=history&page=${page}&pageSize=${pageSize}`);
  },
};
