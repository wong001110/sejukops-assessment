"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createGuestServiceClient, GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";
import { readStaffWorkspaceEntry } from "@/lib/services/staff-accounts/entry";

export async function signInStaff(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 ||
      !email.includes("@") || password.length < 1 || password.length > 128) {
    redirect("/login?error=invalid");
  }
  const client = await createServerSupabaseClient();
  const signIn = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (signIn.error) redirect("/login?error=invalid");
  const actor = await getServerActorContext().catch(() => null);
  if (!actor || actor.isAnonymous ||
      (actor.platformRole !== "SUPER_ADMIN" && (!actor.staff || !actor.staff.sessionAllowed))) {
    await client.auth.signOut({ scope: "local" });
    redirect("/login?error=invalid");
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(GUEST_COOKIE_NAME)?.value;
  if (isGuestToken(token)) {
    const service = createGuestServiceClient();
    if (service) {
      await service.from("guest_visits").update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", guestTokenHash(token)).is("revoked_at", null);
    }
  }
  cookieStore.delete(GUEST_COOKIE_NAME);
  if (actor.platformRole === "SUPER_ADMIN") redirect("/owner");
  if (actor.staff?.passwordChangeRequired) redirect("/account/password");
  const workspaceId = await readStaffWorkspaceEntry(actor, client);
  if (!workspaceId) {
    await client.auth.signOut({ scope: "local" });
    redirect("/login?error=invalid");
  }
  redirect(`/workspaces/${workspaceId}/overview`);
}

export async function signOutStaff(): Promise<void> {
  const client = await createServerSupabaseClient();
  await client.auth.signOut({ scope: "local" });
  redirect("/login");
}
