import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { GuestVisit } from "@/lib/auth/guest-session";
import { createPlatformDataContext } from "@/lib/supabase/platform-server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/** Pass only a freshly verified server-side Guest visit, never request JSON. */
export type GuestAiBudgetScope = Pick<GuestVisit, "id" | "workspaceId" | "demoGeneration">;

export type GuestAiBudgetSnapshot = Readonly<{
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}>;

export type GuestAiReservation = GuestAiBudgetSnapshot & Readonly<{
  allowed: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validScope(scope: GuestAiBudgetScope): boolean {
  return UUID.test(scope.id) && UUID.test(scope.workspaceId)
    && Number.isSafeInteger(scope.demoGeneration) && scope.demoGeneration > 0;
}

function parseSnapshot(value: unknown): GuestAiBudgetSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.used) || (item.used as number) < 0
      || !Number.isSafeInteger(item.limit) || (item.limit as number) < 1
      || !Number.isSafeInteger(item.remaining) || (item.remaining as number) < 0
      || typeof item.resetAt !== "string" || !Number.isFinite(Date.parse(item.resetAt))) return null;
  return {
    used: item.used as number,
    limit: item.limit as number,
    remaining: item.remaining as number,
    resetAt: item.resetAt,
  };
}

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  const { url } = getSupabasePublicConfig();
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** One reservation per outbound paid-model request, immediately before dispatch. */
export async function reserveGuestAiCall(scope: GuestAiBudgetScope): Promise<GuestAiReservation | null> {
  if (!validScope(scope)) return null;
  try {
    const service = serviceClient();
    if (!service) return null;
    const { data, error } = await service.rpc("guest_ai_budget_reserve", {
      p_visit_id: scope.id,
      p_workspace_id: scope.workspaceId,
      p_generation: scope.demoGeneration,
    });
    const snapshot = !error && parseSnapshot(data);
    if (!snapshot || typeof (data as Record<string, unknown>).allowed !== "boolean") return null;
    return { ...snapshot, allowed: (data as { allowed: boolean }).allowed };
  } catch {
    return null;
  }
}

/** Status is read only after the same Guest visit validation as reservation. */
export async function readGuestAiBudget(scope: GuestAiBudgetScope): Promise<GuestAiBudgetSnapshot | null> {
  if (!validScope(scope)) return null;
  try {
    const service = serviceClient();
    if (!service) return null;
    const { data, error } = await service.rpc("guest_ai_budget_status", {
      p_visit_id: scope.id,
      p_workspace_id: scope.workspaceId,
      p_generation: scope.demoGeneration,
    });
    return error ? null : parseSnapshot(data);
  } catch {
    return null;
  }
}

/** Owner-only status access; the platform gate runs before service data reads. */
export async function readGuestAiBudgetForAdmin(): Promise<GuestAiBudgetSnapshot | null> {
  const { actor, supabase } = await createPlatformDataContext("ai_config:view");
  const { data, error } = await supabase.rpc("guest_ai_budget_status_admin", {
    p_actor_auth_user_id: actor.authUserId,
  });
  return error ? null : parseSnapshot(data);
}

/** Re-resolves the Owner actor before creating a service client. */
export async function setGuestAiDailyLimit(limit: number): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("Guest AI daily limit must be between 1 and 1000");
  }
  const { actor, supabase } = await createPlatformDataContext("ai_config:manage");
  const { data, error } = await supabase.rpc("guest_ai_budget_set_limit", {
    p_actor_auth_user_id: actor.authUserId,
    p_daily_limit: limit,
  });
  if (error || data !== limit) throw new Error("Guest AI daily limit could not be saved");
  return limit;
}
