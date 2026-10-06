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
  /** False for onboarding or revoked staff sessions. Filled by the server resolver. */
  businessReady?: boolean;
  staff?: Readonly<{
    passwordChangeRequired: boolean;
    sessionAllowed: boolean;
    authRevision: string;
  }>;
  /** Signed caller JWT session identity, resolved by the database status RPC. */
  sessionId?: string | null;
  preview?: Readonly<{
    readOnly: true;
    effectiveEmployeeProfileId: string | null;
    effectiveEmployeeName?: string | null;
    previewId?: string;
  }>;
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
  if (actor.businessReady === false) return false;
  if (PLATFORM_PERMISSIONS.has(permission)) {
    return !actor.isAnonymous && actor.platformRole === "SUPER_ADMIN";
  }

  const membership = actor.membership;
  if (!membership) return false;
  if (actor.isAnonymous && membership.kind !== "DEMO") return false;
  if (actor.preview && !PREVIEW_READ_PERMISSIONS.has(permission)) return false;

  return hasPermission(membership.role, permission);
}

const PREVIEW_READ_PERMISSIONS: ReadonlySet<AppPermission> = new Set([
  "order:view", "job:view_assigned", "review:view", "dashboard:view",
]);

/** Knowledge excerpts are a separate read-only capability, not native agent access. */
export function canUseKnowledgeAi(actor: ActorContext): boolean {
  return !actor.preview && (hasActorPermission(actor, "ai:use") ||
    hasActorPermission(actor, "job:view_assigned"));
}

/** Operations may read assigned jobs; this does not grant native AI or proposal access. */
export function canUseOperationsAi(actor: ActorContext): boolean {
  return !actor.preview && canUseKnowledgeAi(actor) &&
    (hasActorPermission(actor, "order:view") || hasActorPermission(actor, "job:view_assigned"));
}
