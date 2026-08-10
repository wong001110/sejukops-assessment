"use client";

import type {
  ConfirmDocumentImportInput,
  ConfirmDocumentImportResponse,
  ConfirmDocumentSourceInput,
  DocumentImportApiErrorEnvelope,
  DocumentImportDetailResponse,
  DocumentImportMutationResponse,
  DocumentImportReservationResponse,
  ExtractDocumentImportInput,
  ReserveDocumentImportInput,
} from "@/domain/document-understanding/contracts";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export class DocumentImportApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly fieldErrors?: Readonly<Record<string, readonly string[] | undefined>>,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DocumentImportApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null) as T | DocumentImportApiErrorEnvelope | null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? (payload as DocumentImportApiErrorEnvelope).error
      : undefined;
    throw new DocumentImportApiError(
      error?.message ?? "The document request could not be completed.",
      error?.code,
      error?.fieldErrors,
      response.status,
    );
  }
  return payload as T;
}

export const documentImportApi = {
  reserve: (input: ReserveDocumentImportInput) =>
    request<DocumentImportReservationResponse>("/api/admin/document-imports/reservations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  async uploadSource(
    reservation: DocumentImportReservationResponse,
    file: File,
  ): Promise<void> {
    if (!reservation.upload) {
      if (reservation.documentImport.sourceStatus === "UPLOADED") return;
      throw new DocumentImportApiError(
        "This upload reservation cannot continue. Start a new document import.",
        "DOCUMENT_STORAGE_FAILED",
      );
    }
    const storage = createBrowserSupabaseClient().storage.from(reservation.upload.bucket);
    const result = await storage.uploadToSignedUrl(
      reservation.upload.path,
      reservation.upload.token,
      file,
      { contentType: file.type },
    );
    if (result.error) {
      throw new DocumentImportApiError(
        "The source upload paused before confirmation. Retry this file; no order was created.",
        "DOCUMENT_STORAGE_FAILED",
      );
    }
  },
  confirmSource: (documentImportId: string, input: ConfirmDocumentSourceInput) =>
    request<DocumentImportMutationResponse>(`/api/admin/document-imports/${documentImportId}/source/confirm`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  detail: (documentImportId: string) =>
    request<DocumentImportDetailResponse>(`/api/admin/document-imports/${documentImportId}`),
  extract: (documentImportId: string, input: ExtractDocumentImportInput) =>
    request<DocumentImportMutationResponse>(`/api/admin/document-imports/${documentImportId}/extract`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  confirm: (documentImportId: string, input: ConfirmDocumentImportInput) =>
    request<ConfirmDocumentImportResponse>(`/api/admin/document-imports/${documentImportId}/confirm`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
