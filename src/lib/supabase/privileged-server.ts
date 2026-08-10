import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentDemoIdentity } from "@/lib/auth/server";
import {
  requirePermission,
  type AppPermission,
} from "@/lib/auth/permissions";
import type { DemoIdentity } from "@/lib/auth/types";

import { getSupabasePublicConfig } from "./config";

export class SupabaseServiceRoleConfigurationError extends Error {
  readonly code = "SUPABASE_SERVICE_ROLE_CONFIGURATION_MISSING";

  constructor() {
    super("Server data access is unavailable because SUPABASE_SERVICE_ROLE_KEY is missing");
    this.name = "SupabaseServiceRoleConfigurationError";
  }
}

export type AuthorizedDataContext = Readonly<{
  identity: DemoIdentity;
  supabase: SupabaseClient;
}>;

/**
 * Assessment auth is intentionally mocked, so it cannot produce a Supabase
 * Auth JWT for RLS. Privileged database access is therefore confined to this
 * server-only factory and is always coupled to the validated mock identity and
 * an explicit application permission. Feature services must add record-level
 * checks (for example assigned-technician ownership) before mutations.
 */
export async function createAuthorizedDataContext(
  permission: AppPermission,
): Promise<AuthorizedDataContext> {
  const identity = await getCurrentDemoIdentity();
  if (!identity) {
    throw new PermissionDeniedErrorForAnonymous(permission);
  }
  requirePermission(identity.role, permission);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new SupabaseServiceRoleConfigurationError();
  }

  const { url } = getSupabasePublicConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { identity, supabase };
}

class PermissionDeniedErrorForAnonymous extends Error {
  readonly code = "DEMO_SESSION_REQUIRED";

  constructor(permission: AppPermission) {
    super(`A demo session is required for ${permission}`);
    this.name = "PermissionDeniedErrorForAnonymous";
  }
}
