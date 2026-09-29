import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";

import { getSupabasePublicConfig } from "./config";

export class SupabaseServiceRoleConfigurationError extends Error {
  readonly code = "SUPABASE_SERVICE_ROLE_CONFIGURATION_MISSING";

  constructor() {
    super("Server data access is unavailable because SUPABASE_SERVICE_ROLE_KEY is missing");
    this.name = "SupabaseServiceRoleConfigurationError";
  }
}

type PlatformPermission = "ai_config:view" | "ai_config:manage" | "diagnostics:view";

export class PlatformPermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";

  constructor() {
    super("A verified platform Super Admin is required");
    this.name = "PlatformPermissionDeniedError";
  }
}

export type PlatformDataContext = Readonly<{
  actor: ActorContext;
  supabase: SupabaseClient;
}>;

/** Service credentials are only created after a fresh, server-resolved gate. */
export async function createPlatformDataContext(
  permission: PlatformPermission,
): Promise<PlatformDataContext> {
  const actor = await getServerActorContext();
  if (!actor || !hasActorPermission(actor, permission)) {
    throw new PlatformPermissionDeniedError();
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new SupabaseServiceRoleConfigurationError();

  const { url } = getSupabasePublicConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { actor, supabase };
}
