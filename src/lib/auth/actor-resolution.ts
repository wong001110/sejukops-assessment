import type { ActorContext, PlatformRole, WorkspaceKind } from "./actor-policy";
import type { AppRole } from "./types";

export type VerifiedAuthUser = Readonly<{
  id: string;
  isAnonymous: boolean;
}>;

export type ProfileRecord = Readonly<{
  id: string;
  authUserId: string;
  platformRole: PlatformRole;
  active: boolean;
}>;

export type MembershipRecord = Readonly<{
  profileId: string;
  workspaceId: string;
  role: AppRole;
  active: boolean;
  workspaceKind: WorkspaceKind;
  workspaceActive: boolean;
}>;

/** A selected workspace is a request, not an authorization claim. */
export function resolveActorContext(
  user: VerifiedAuthUser,
  profile: ProfileRecord | null,
  selectedWorkspaceId?: string,
  membership?: MembershipRecord | null,
): ActorContext | null {
  if (!profile || !profile.active || profile.authUserId !== user.id) return null;

  const actor: ActorContext = {
    authUserId: user.id,
    profileId: profile.id,
    isAnonymous: user.isAnonymous,
    platformRole: user.isAnonymous ? "USER" : profile.platformRole,
  };

  if (!selectedWorkspaceId) return actor;
  if (
    !membership ||
    !membership.active ||
    !membership.workspaceActive ||
    membership.profileId !== profile.id ||
    membership.workspaceId !== selectedWorkspaceId ||
    (user.isAnonymous && membership.workspaceKind !== "DEMO")
  ) {
    return null;
  }

  return {
    ...actor,
    membership: {
      workspaceId: membership.workspaceId,
      kind: membership.workspaceKind,
      role: membership.role,
    },
  };
}
