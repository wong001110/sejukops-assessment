import type { AppRole } from "./types";

export type AppPermission =
  | "order:create"
  | "order:view"
  | "order:assign"
  | "order:update"
  | "order:reschedule"
  | "job:view_assigned"
  | "job:start_assigned"
  | "job:complete_assigned"
  | "review:view"
  | "review:approve"
  | "dashboard:view";

const ROLE_PERMISSIONS: Readonly<Record<AppRole, readonly AppPermission[]>> = {
  ADMIN: ["order:create", "order:view", "order:assign", "order:update", "order:reschedule"],
  MANAGER: ["order:view", "order:reschedule", "review:view", "review:approve", "dashboard:view"],
  TECHNICIAN: ["job:view_assigned", "job:start_assigned", "job:complete_assigned"],
};

export function hasPermission(role: AppRole, permission: AppPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";

  constructor(role: AppRole, permission: AppPermission) {
    super(`${role} does not have ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function requirePermission(role: AppRole, permission: AppPermission): void {
  if (!hasPermission(role, permission)) {
    throw new PermissionDeniedError(role, permission);
  }
}
