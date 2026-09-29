import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { ActorContext } from "@/lib/auth/actor-policy";
import { demoIpDigest, trustedDemoIp } from "@/lib/auth/demo-entry";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/** A failed reservation must never result in a provider request. */
export async function reserveDemoAiCall(
  actor: ActorContext,
  workspaceId: string,
  headers: Headers,
): Promise<boolean> {
  if (actor.membership?.kind !== "DEMO"
      || actor.membership.workspaceId !== workspaceId) return false;
  const ip = trustedDemoIp(headers);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!ip || !serviceKey) return false;

  const { url } = getSupabasePublicConfig();
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await service.rpc("demo_ai_reserve", {
    p_auth_user_id: actor.authUserId,
    p_workspace_id: workspaceId,
    p_ip_digest: demoIpDigest(ip, serviceKey),
  });
  return !error && data === true;
}
