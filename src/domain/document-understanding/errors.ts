export type DocumentUnderstandingErrorCode =
  | "DOCUMENT_VALIDATION_FAILED"
  | "DOCUMENT_PERMISSION_DENIED"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_CONFLICT"
  | "DOCUMENT_STORAGE_FAILED"
  | "DOCUMENT_TEXT_UNREADABLE"
  | "DOCUMENT_EXTRACTION_FAILED"
  | "DOCUMENT_DATA_ACCESS_FAILED";

export class DocumentUnderstandingError extends Error {
  constructor(
    readonly code: DocumentUnderstandingErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 | 502 | 503 | 504,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentUnderstandingError";
  }
}
