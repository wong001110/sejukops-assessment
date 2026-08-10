"use client";

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

// The list endpoint is intentionally restricted to actionable Technician work.
export type TechnicianJob = TechnicianJobListItem & { status: "ASSIGNED" | "IN_PROGRESS" };
export type TechnicianJobDetailResponse = { job: TechnicianJobDetail & { status: "ASSIGNED" | "IN_PROGRESS" }; auditEvents: TechnicianJobAuditEvent[]; reschedules: TechnicianJobReschedule[]; rescheduleRequests: TechnicianRescheduleRequest[]; notifications: TechnicianInternalNotification[] };

export class TechnicianJobApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "TechnicianJobApiError"; }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | T | null;
  if (!response.ok) throw new TechnicianJobApiError((body as { error?: { message?: string } } | null)?.error?.message ?? "The request could not be completed.", response.status);
  return body as T;
}
export const technicianJobApi = {
  list: () => request<{ jobs: TechnicianJob[] }>("/api/technician/jobs"),
  detail: (id: string) => request<TechnicianJobDetailResponse>(`/api/technician/jobs/${id}`),
  start: (id: string, input: StartTechnicianJobInput) => request<{ job: TechnicianJobDetail & { status: "IN_PROGRESS" }; startedAt: string }>(`/api/technician/jobs/${id}/start`, { method: "POST", body: JSON.stringify(input) }),
  requestReschedule: (id: string, input: CreateTechnicianRescheduleRequestInput) => request<{ request: TechnicianRescheduleRequest }>(`/api/technician/jobs/${id}/reschedule-request`, { method: "POST", body: JSON.stringify(input) }),
};
