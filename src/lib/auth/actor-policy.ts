import { hasPermission, type AppPermission } from "./permissions";
import type { AppRole } from "./types";

export type PlatformRole = "SUPER_ADMIN" | "USER";
export type WorkspaceKind = "DEMO" | "OWNER";

export type WorkspaceMembership = Readonly<{
  workspaceId: string;
  kind: WorkspaceKind;
  role: AppRole;
}>;

/**
 * Server-resolved identity and membership. A client-selected role, workspace,
 * or model tool argument must never be used to construct this object directly.
 */
export type ActorContext = Readonly<{
  authUserId: string;
  profileId: string;
  isAnonymous: boolean;
  platformRole: PlatformRole;
  membership?: WorkspaceMembership;
}>;

const PLATFORM_PERMISSIONS: ReadonlySet<AppPermission> = new Set([
  "ai_config:view",
  "ai_config:manage",
  "diagnostics:view",
]);

export function hasActorPermission(
  actor: ActorContext,
  permission: AppPermission,
): boolean {
  if (PLATFORM_PERMISSIONS.has(permission)) {
    return !actor.isAnonymous && actor.platformRole === "SUPER_ADMIN";
  }

  const membership = actor.membership;
  if (!membership) return false;
  if (actor.isAnonymous && membership.kind !== "DEMO") return false;

  return hasPermission(membership.role, permission);
}
