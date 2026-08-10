export class ManagerDashboardError extends Error {
  constructor(
    readonly code:
      | "MANAGER_DASHBOARD_PERMISSION_DENIED"
      | "MANAGER_DASHBOARD_DATA_ACCESS_FAILED",
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagerDashboardError";
  }
}
