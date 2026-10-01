"use client";

import type { StaffAccountInput, StaffAccountList, StaffAccountSummary, StaffCreateResult, StaffCredential, StaffImportDraft, StaffImportResult, StaffRole } from "@/domain/staff/contracts";

export class StaffApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); this.name = "StaffApiError"; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", ...(init?.body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new StaffApiError(body?.error?.message ?? "The staff request failed. Please retry.", body?.error?.code, response.status);
  if (!body) throw new StaffApiError("The staff response was incomplete. Please retry.");
  return body as T;
}

const root = "/api/platform/staff";
export const staffApi = {
  list: (workspaceId: string, signal?: AbortSignal) => request<StaffAccountList>(`${root}?workspaceId=${encodeURIComponent(workspaceId)}`, { signal }),
  create: (workspaceId: string, requestKey: string, input: StaffAccountInput) => request<StaffCreateResult>(root, { method: "POST", body: JSON.stringify({ workspaceId, requestKey, input }) }),
  update: (workspaceId: string, account: StaffAccountSummary, input: { role: StaffRole; branchCode: string | null; active: boolean }) => request<{ account: StaffAccountSummary }>(`${root}/${encodeURIComponent(account.profileId)}`, { method: "PATCH", body: JSON.stringify({ workspaceId, expectedRevision: account.authRevision, ...input }) }),
  resetPassword: (workspaceId: string, account: StaffAccountSummary, requestKey: string) => request<{ account: StaffAccountSummary; credential: StaffCredential | null; status: "RESET" | "ALREADY_RESET" }>(`${root}/${encodeURIComponent(account.profileId)}/password`, { method: "POST", body: JSON.stringify({ workspaceId, expectedRevision: account.authRevision, requestKey }) }),
  preview: (workspaceId: string, file: File, signal?: AbortSignal) => { const body = new FormData(); body.set("workspaceId", workspaceId); body.set("file", file); return request<StaffImportDraft>(`${root}/import/preview`, { method: "POST", body, signal }); },
  confirm: (workspaceId: string, importId: string, retryFailed = false) => request<{ results: StaffImportResult[]; complete: boolean }>(`${root}/import/confirm`, { method: "POST", body: JSON.stringify({ workspaceId, importId, ...(retryFailed ? { retryFailed: true } : {}) }) }),
};
