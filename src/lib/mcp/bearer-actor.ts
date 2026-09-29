import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveActorContext, type MembershipRecord, type ProfileRecord } from "@/lib/auth/actor-resolution";
import type { ActorContext, PlatformRole, WorkspaceKind } from "@/lib/auth/actor-policy";
import type { AppRole } from "@/lib/auth/types";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

export class McpAuthenticationError extends Error {
  constructor() { super("MCP bearer authentication failed"); this.name = "McpAuthenticationError"; }
}

/** No cookie, API key, model argument, or service-role credential is accepted. */
export async function verifyMcpBearer(request: Request): Promise<{
  authUserId: string; isAnonymous: boolean; client: SupabaseClient;
}> {
  if (request.headers.has("cookie")) throw new McpAuthenticationError();
  const match = BEARER.exec(request.headers.get("authorization") ?? "");
  if (!match || match[1].length > 8192 || match[1].split(".").length !== 3) {
    throw new McpAuthenticationError();
  }
  const token = match[1];
  const { url, anonKey } = getSupabasePublicConfig();
  const verifier = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: claimsData, error: claimsError } = await verifier.auth.getClaims(token);
  const claims = claimsData?.claims;
  const expectedIssuer = `${url.replace(/\/$/, "")}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  if (claimsError || !claims || claims.iss !== expectedIssuer ||
      !(claims.aud === "authenticated" ||
        (Array.isArray(claims.aud) && claims.aud.includes("authenticated"))) ||
      claims.role !== "authenticated" || !UUID.test(String(claims.sub)) ||
      !UUID.test(String(claims.session_id)) ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now) ||
      typeof claims.is_anonymous !== "boolean") {
    throw new McpAuthenticationError();
  }
  // Auth's network lookup catches removed users as well as malformed sessions.
  const { data: userData, error: userError } = await verifier.auth.getUser(token);
  if (userError || !userData.user || userData.user.id !== claims.sub ||
      (userData.user.is_anonymous === true) !== claims.is_anonymous) {
    throw new McpAuthenticationError();
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new McpAuthenticationError();
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: activeSession, error: sessionError } = await service.rpc("mcp_session_active", {
    p_auth_user_id: userData.user.id, p_session_id: claims.session_id,
  });
  if (sessionError || activeSession !== true) throw new McpAuthenticationError();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
  return { authUserId: userData.user.id, isAnonymous: claims.is_anonymous, client };
}

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === "USER" || value === "SUPER_ADMIN";
}
function isAppRole(value: unknown): value is AppRole {
  return value === "ADMIN" || value === "MANAGER" || value === "TECHNICIAN";
}
function isKind(value: unknown): value is WorkspaceKind {
  return value === "DEMO" || value === "OWNER";
}

/** Re-read active membership for every tool call; Supabase RLS also enforces it. */
export async function resolveMcpWorkspaceActor(
  identity: Awaited<ReturnType<typeof verifyMcpBearer>>,
  workspaceId: string,
): Promise<ActorContext> {
  if (!UUID.test(workspaceId)) throw new McpAuthenticationError();
  const { client } = identity;
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("id,auth_user_id,platform_role,active")
    .eq("auth_user_id", identity.authUserId).maybeSingle();
  if (profileError || !profile || !isPlatformRole(profile.platform_role)) throw new McpAuthenticationError();
  const { data: membership, error: membershipError } = await client.from("workspace_memberships")
    .select("profile_id,workspace_id,role,active")
    .eq("profile_id", profile.id).eq("workspace_id", workspaceId).maybeSingle();
  const { data: workspace, error: workspaceError } = await client.from("workspaces")
    .select("id,kind,active")
    .eq("id", workspaceId).maybeSingle();
  if (membershipError || workspaceError || !membership || !workspace ||
      !isAppRole(membership.role) || !isKind(workspace.kind)) throw new McpAuthenticationError();
  const profileRecord: ProfileRecord = {
    id: profile.id, authUserId: profile.auth_user_id,
    platformRole: profile.platform_role, active: profile.active === true,
  };
  const membershipRecord: MembershipRecord = {
    profileId: membership.profile_id, workspaceId: membership.workspace_id,
    role: membership.role, active: membership.active === true,
    workspaceKind: workspace.kind, workspaceActive: workspace.active === true,
  };
  const actor = resolveActorContext(
    { id: identity.authUserId, isAnonymous: identity.isAnonymous },
    profileRecord, workspaceId, membershipRecord,
  );
  if (!actor) throw new McpAuthenticationError();
  return actor;
}
