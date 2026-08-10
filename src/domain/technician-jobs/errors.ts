export type TechnicianJobErrorCode =
  | "TECHNICIAN_JOB_VALIDATION_FAILED"
  | "TECHNICIAN_JOB_PERMISSION_DENIED"
  | "TECHNICIAN_JOB_NOT_FOUND"
  | "TECHNICIAN_JOB_NOT_ASSIGNED"
  | "TECHNICIAN_JOB_CONFLICT"
  | "TECHNICIAN_JOB_DATA_ACCESS_FAILED";

export class TechnicianJobError extends Error {
  constructor(
    readonly code: TechnicianJobErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TechnicianJobError";
  }
}
