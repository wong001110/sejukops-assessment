import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActorContext } from "./actor-policy";
import { createGuestPrincipalContext } from "./guest-principal";
import { GUEST_COOKIE_NAME, createGuestServiceClient, resolveGuestVisit, type GuestVisit } from "./guest-session";
import { getServerActorContext, resolveActorFromAuthenticatedClient } from "./server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceRequestContext = Readonly<{
  actor: ActorContext;
  client: SupabaseClient;
  guestVisit: GuestVisit | null;
}>;

/** Keep the actor and RLS client from one resolved identity on this request. */
export async function resolveWorkspaceRequestContext(
  workspaceId: string,
): Promise<WorkspaceRequestContext | null> {
  if (!UUID.test(workspaceId)) return null;
  const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
  if (token) {
    // A browser session cannot ambiguously combine Owner Auth with Guest scope.
    const browserClient = await createServerSupabaseClient();
    const { data, error } = await browserClient.auth.getUser();
    if (data.user || (error && error.name !== "AuthSessionMissingError")) return null;
    const guest = await createGuestPrincipalContext(token);
    if (!guest || guest.visit.workspaceId !== workspaceId) return null;
    return { actor: guest.actor, client: guest.client, guestVisit: guest.visit };
  }

  const actor = await getServerActorContext(workspaceId);
  if (!actor?.membership || actor.membership.workspaceId !== workspaceId) return null;
  return { actor, client: await createServerSupabaseClient(), guestVisit: null };
}

/** Deduplicate layout/page resolution within a single Server Component request. */
export const getWorkspaceRequestContext = cache(resolveWorkspaceRequestContext);

/** Recheck the bound Auth session and opaque visit without signing the fixed Guest principal in again. */
export async function refreshWorkspaceRequestContext(scope: WorkspaceRequestContext, workspaceId: string): Promise<WorkspaceRequestContext | null> {
  const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
  if (!scope.guestVisit && token) return null;
  const service = scope.guestVisit ? createGuestServiceClient() : null;
  if (scope.guestVisit && !service) return null;
  const [actorRead, visitRead] = await Promise.allSettled([
    resolveActorFromAuthenticatedClient(scope.client, workspaceId),
    scope.guestVisit && service ? resolveGuestVisit(service, token) : Promise.resolve(null),
  ]);
  if (actorRead.status !== "fulfilled" || visitRead.status !== "fulfilled") return null;
  const actor = actorRead.value, guestVisit = visitRead.value;
  if (!actor?.membership || actor.membership.workspaceId !== workspaceId ||
    (scope.guestVisit && (!guestVisit || guestVisit.workspaceId !== workspaceId || guestVisit.persona !== actor.membership.role))) return null;
  return { actor, client: scope.client, guestVisit };
}
