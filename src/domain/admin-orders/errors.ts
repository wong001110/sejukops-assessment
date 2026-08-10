export type AdminOrderErrorCode =
  | "ADMIN_ORDER_VALIDATION_FAILED"
  | "ADMIN_ORDER_PERMISSION_DENIED"
  | "ADMIN_ORDER_NOT_FOUND"
  | "ADMIN_ORDER_CONFLICT"
  | "ADMIN_ORDER_DATA_ACCESS_FAILED";

export class AdminOrderError extends Error {
  constructor(
    readonly code: AdminOrderErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdminOrderError";
  }
}
