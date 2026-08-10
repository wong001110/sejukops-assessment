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
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import type { CompleteTechnicianJobInput, EvidenceUploadAuthorization, TechnicianCompletionResponse, TechnicianEvidenceItem } from "@/domain/technician-completion/contracts";

// The list endpoint is intentionally restricted to actionable Technician work.
export type TechnicianJob = TechnicianJobListItem & { status: "ASSIGNED" | "IN_PROGRESS" };
export type TechnicianJobDetailResponse = { job: TechnicianJobDetail & { status: "ASSIGNED" | "IN_PROGRESS" }; auditEvents: TechnicianJobAuditEvent[]; reschedules: TechnicianJobReschedule[]; rescheduleRequests: TechnicianRescheduleRequest[]; notifications: TechnicianInternalNotification[] };
export type CompletionResult = TechnicianCompletionResponse;

export class TechnicianJobApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "TechnicianJobApiError"; }
}
export class TechnicianEvidenceUploadError extends TechnicianJobApiError {
  constructor(message: string, readonly evidenceId: string, status?: number) { super(message, status); this.name = "TechnicianEvidenceUploadError"; }
}
export function evidenceIdFromUploadFailure(cause: unknown): string | undefined {
  return cause instanceof TechnicianEvidenceUploadError ? cause.evidenceId : undefined;
}
export function evidenceIdAfterUploadFailure(cause: unknown, existingId?: string): string | undefined {
  return evidenceIdFromUploadFailure(cause) ?? existingId;
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

export const technicianCompletionApi = {
  listEvidence: (jobId: string) => request<{ evidence: TechnicianEvidenceItem[] }>(`/api/technician/jobs/${jobId}/evidence`),
  async uploadEvidence(jobId: string, file: File, requestKey: string): Promise<{ id: string }> {
    const reservation = await request<{ evidence: TechnicianEvidenceItem; upload: EvidenceUploadAuthorization | null }>(`/api/technician/jobs/${jobId}/evidence/reservations`, { method: "POST", body: JSON.stringify({ originalFilename: file.name, mimeType: file.type, sizeBytes: file.size, requestKey }) });
    if (!reservation.upload) {
      if (reservation.evidence.status === "UPLOADED" || reservation.evidence.status === "ATTACHED") return { id: reservation.evidence.id };
      throw new TechnicianEvidenceUploadError("This evidence reservation cannot continue. Remove it and add the file again.", reservation.evidence.id);
    }
    const storage = createBrowserSupabaseClient().storage.from("service-evidence");
    const upload = await storage.uploadToSignedUrl(reservation.upload.path, reservation.upload.token, file, { contentType: file.type });
    if (upload.error) throw new TechnicianEvidenceUploadError("Evidence upload failed. Retry this file.", reservation.evidence.id);
    try {
      await request<{ evidence: TechnicianEvidenceItem }>(`/api/technician/jobs/${jobId}/evidence/${reservation.evidence.id}/confirm`, { method: "POST", body: JSON.stringify({ requestKey }) });
    } catch (cause) {
      if (cause instanceof TechnicianJobApiError) throw new TechnicianEvidenceUploadError(cause.message, reservation.evidence.id, cause.status);
      throw new TechnicianEvidenceUploadError("Evidence confirmation failed. Retry this file.", reservation.evidence.id);
    }
    return { id: reservation.evidence.id };
  },
  removeEvidence: (jobId: string, evidenceId: string) => request<void>(`/api/technician/jobs/${jobId}/evidence/${evidenceId}`, { method: "DELETE" }),
  complete: (jobId: string, input: CompleteTechnicianJobInput) => request<CompletionResult>(`/api/technician/jobs/${jobId}/completion`, { method: "POST", body: JSON.stringify(input) }),
};
