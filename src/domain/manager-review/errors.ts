export type ManagerReviewErrorCode =
  | "MANAGER_REVIEW_VALIDATION_FAILED"
  | "MANAGER_REVIEW_PERMISSION_DENIED"
  | "MANAGER_REVIEW_NOT_FOUND"
  | "MANAGER_REVIEW_CONFLICT"
  | "MANAGER_REVIEW_DATA_ACCESS_FAILED";

export class ManagerReviewError extends Error {
  constructor(
    readonly code: ManagerReviewErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagerReviewError";
  }
}
