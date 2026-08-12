import type { AppRole } from "./types";

export type AppPermission =
  | "order:create"
  | "order:view"
  | "order:assign"
  | "order:update"
  | "order:reschedule"
  | "job:view_assigned"
  | "job:start_assigned"
  | "job:request_reschedule"
  | "job:complete_assigned"
  | "evidence:upload"
  | "payment:record"
  | "review:view"
  | "review:approve"
  | "dashboard:view"
  | "ai_config:view"
  | "ai_config:manage"
  | "ai:use"
  | "diagnostics:view";

const ROLE_PERMISSIONS: Readonly<Record<AppRole, readonly AppPermission[]>> = {
  ADMIN: [
    "order:create",
    "order:view",
    "order:assign",
    "order:update",
    "order:reschedule",
    "ai_config:view",
    "ai_config:manage",
    "ai:use",
    "diagnostics:view",
  ],
  MANAGER: [
    "order:view",
    "order:reschedule",
    "review:view",
    "review:approve",
    "dashboard:view",
    "ai:use",
    "diagnostics:view",
  ],
  TECHNICIAN: [
    "job:view_assigned",
    "job:start_assigned",
    "job:request_reschedule",
    "job:complete_assigned",
    "evidence:upload",
    "payment:record",
  ],
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
