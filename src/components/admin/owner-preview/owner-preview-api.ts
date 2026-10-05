"use client";
import type { OwnerPreviewInput, OwnerPreviewOptions, OwnerPreviewStatus } from "@/domain/staff/owner-preview-contracts";
const endpoint = "/api/platform/owner-preview";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error?.message ?? "Preview is unavailable. Return to Owner and try again.");
  return body as T;
}
export const ownerPreviewApi = {
  get: (workspaceId: string, signal?: AbortSignal) => request<OwnerPreviewOptions & { preview: OwnerPreviewStatus | null }>(`${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}`, { signal }),
  set: (input: OwnerPreviewInput) => request<{ preview: OwnerPreviewStatus }>(endpoint, { method: "POST", body: JSON.stringify(input) }),
  exit: () => request<{ preview: null }>(endpoint, { method: "DELETE" }),
};
