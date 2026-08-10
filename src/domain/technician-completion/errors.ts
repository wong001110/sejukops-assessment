export type TechnicianCompletionErrorCode =
  | "TECHNICIAN_COMPLETION_VALIDATION_FAILED"
  | "TECHNICIAN_COMPLETION_PERMISSION_DENIED"
  | "TECHNICIAN_COMPLETION_NOT_FOUND"
  | "TECHNICIAN_COMPLETION_CONFLICT"
  | "TECHNICIAN_COMPLETION_STORAGE_FAILED"
  | "TECHNICIAN_COMPLETION_DATA_ACCESS_FAILED";

export class TechnicianCompletionError extends Error {
  constructor(
    readonly code: TechnicianCompletionErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 502 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TechnicianCompletionError";
  }
}
