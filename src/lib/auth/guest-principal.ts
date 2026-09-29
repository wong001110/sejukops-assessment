import "server-only";

import { createHmac } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

import type { ActorContext } from "./actor-policy";
import type { DemoPersona } from "./demo-entry";
import { createGuestServiceClient, resolveGuestVisit, type GuestVisit } from "./guest-session";
import { resolveActorFromAuthenticatedClient } from "./server-actor";

export const GUEST_PRINCIPAL_EMAILS: Readonly<Record<DemoPersona, string>> = {
  ADMIN: "guest-admin@sejukops.example",
  MANAGER: "guest-manager@sejukops.example",
  TECHNICIAN: "guest-technician@sejukops.example",
};

/** Domain-separated credential; never send it or the resulting session to a browser. */
export function deriveGuestPrincipalPassword(
  serviceRoleKey: string,
  projectHost: string,
  persona: DemoPersona,
): string {
  if (!serviceRoleKey || !/^[-a-z0-9.]+\.supabase\.co$/i.test(projectHost)
    || !Object.hasOwn(GUEST_PRINCIPAL_EMAILS, persona)) {
    throw new Error("Guest principal credential configuration is invalid");
  }
  return createHmac("sha256", serviceRoleKey)
    .update(`sejukops:fixed-demo-principal:v1\0${projectHost.toLowerCase()}\0${persona}`)
    .digest("base64url");
}

export type GuestPrincipalContext = Readonly<{
  visit: GuestVisit;
  actor: ActorContext & { membership: NonNullable<ActorContext["membership"]> };
  /** Authenticated, request-local client; its session must remain on the server. */
  client: SupabaseClient;
}>;

/** Resolve the opaque visit first, then authenticate only its DB-stored Demo persona. */
export async function createGuestPrincipalContext(token: unknown): Promise<GuestPrincipalContext | null> {
  const service = createGuestServiceClient();
  if (!service) return null;
  const visit = await resolveGuestVisit(service, token);
  if (!visit) return null;

  const config = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) return null;
  const email = GUEST_PRINCIPAL_EMAILS[visit.persona];
  const password = deriveGuestPrincipalPassword(serviceRoleKey, new URL(config.url).hostname, visit.persona);
  const client = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.user || !signedIn.session
    || signedIn.user.email?.toLowerCase() !== email || signedIn.user.is_anonymous === true) return null;

  const actor = await resolveActorFromAuthenticatedClient(client, visit.workspaceId);
  if (!actor?.membership || actor.authUserId !== signedIn.user.id
    || actor.isAnonymous || actor.platformRole !== "USER"
    || actor.membership.workspaceId !== visit.workspaceId
    || actor.membership.kind !== "DEMO"
    || actor.membership.role !== visit.persona) return null;

  const { data: profile, error: markerError } = await client.from("profiles")
    .select("id,demo_principal")
    .eq("id", actor.profileId)
    .maybeSingle();
  if (markerError || profile?.id !== actor.profileId || profile.demo_principal !== true) return null;

  return { visit, actor: actor as GuestPrincipalContext["actor"], client };
}
