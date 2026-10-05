import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { ActorContext, PlatformRole, WorkspaceKind } from "./actor-policy";
import { resolveActorContext, type MembershipRecord, type ProfileRecord } from "./actor-resolution";
import type { AppRole } from "./types";
import { isStaffBusinessReady, staffSessionStatusSchema } from "./staff-session-status";
import { ownerPreviewStatusSchema } from "@/domain/staff/owner-preview-contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === "USER" || value === "SUPER_ADMIN";
}

function isAppRole(value: unknown): value is AppRole {
  return value === "ADMIN" || value === "MANAGER" || value === "TECHNICIAN";
}

function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return value === "DEMO" || value === "OWNER";
}

/**
 * Resolve authority from a validated Supabase Auth user and database rows.
 * The optional workspace ID is only a requested selection and must match an
 * active membership. This does not accept a client-supplied role or profile.
 */
export async function getServerActorContext(
  selectedWorkspaceId?: string,
): Promise<ActorContext | null> {
  if (selectedWorkspaceId !== undefined && !UUID.test(selectedWorkspaceId)) return null;

  const supabase = await createServerSupabaseClient();
  return resolveActorFromAuthenticatedClient(supabase, selectedWorkspaceId);
}

/** Resolve a DB-backed actor from a request-scoped, authenticated user client. */
export async function resolveActorFromAuthenticatedClient(
  supabase: SupabaseClient,
  selectedWorkspaceId?: string,
): Promise<ActorContext | null> {
  if (selectedWorkspaceId !== undefined && !UUID.test(selectedWorkspaceId)) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id,auth_user_id,platform_role,active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError) throw new Error("Actor profile lookup failed", { cause: profileError });
  if (!profileRow || !isPlatformRole(profileRow.platform_role)) return null;

  const { data: statusRow, error: statusError } = await supabase.rpc("staff_session_status");
  if (statusError) throw new Error("Actor session lookup failed", { cause: statusError });
  const statusResult = staffSessionStatusSchema.safeParse(statusRow);
  if (!statusResult.success) return null;
  const status = statusResult.data;

  const profile: ProfileRecord = {
    id: profileRow.id,
    authUserId: profileRow.auth_user_id,
    platformRole: profileRow.platform_role,
    active: profileRow.active === true,
    businessReady: isStaffBusinessReady(status),
    sessionId: status.sessionId,
    ...(status.isManaged && status.authRevision ? { staff: {
      passwordChangeRequired: status.passwordChangeRequired,
      sessionAllowed: status.sessionAllowed,
      authRevision: status.authRevision,
    } } : {}),
  };
  const user = {
    id: authData.user.id,
    isAnonymous: authData.user.is_anonymous === true,
  };

  if (!selectedWorkspaceId) return resolveActorContext(user, profile);

  const { data: memberRow, error: memberError } = await supabase
    .from("workspace_memberships")
    .select("profile_id,workspace_id,role,active")
    .eq("workspace_id", selectedWorkspaceId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (memberError) throw new Error("Actor membership lookup failed", { cause: memberError });
  if (!memberRow || !isAppRole(memberRow.role)) return null;

  const { data: workspaceRow, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id,kind,active")
    .eq("id", selectedWorkspaceId)
    .maybeSingle();
  if (workspaceError) throw new Error("Actor workspace lookup failed", { cause: workspaceError });
  if (!workspaceRow || !isWorkspaceKind(workspaceRow.kind)) return null;

  const membership: MembershipRecord = {
    profileId: memberRow.profile_id,
    workspaceId: memberRow.workspace_id,
    role: memberRow.role,
    active: memberRow.active === true,
    workspaceKind: workspaceRow.kind,
    workspaceActive: workspaceRow.active === true,
  };
  const actor = resolveActorContext(user, profile, selectedWorkspaceId, membership);
  if (!actor?.membership || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN" || actor.membership.kind !== "OWNER") return actor;

  // Only persisted, session-bound database status supplies an effective perspective.
  // A missing/expired/malformed status must never silently restore Owner writes.
  const { data: previewRow, error: previewError } = await supabase.rpc("owner_preview_status", { p_workspace_id: selectedWorkspaceId });
  if (previewError) throw new Error("Owner preview status unavailable", { cause: previewError });
  if (previewRow === null) return actor;
  const preview = ownerPreviewStatusSchema.safeParse(previewRow);
  if (!preview.success) return null;
  return { ...actor, membership: { ...actor.membership, role: preview.data.role }, preview: {
    previewId: preview.data.previewId, readOnly: true,
    effectiveEmployeeProfileId: preview.data.effectiveEmployeeProfileId,
    effectiveEmployeeName: preview.data.effectiveEmployeeName,
  } };
}
