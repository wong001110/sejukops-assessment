"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { createGuestServiceClient, GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const LOGIN_ERROR_PATH = "/owner/login?error=invalid";

export async function signInOwner(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 320 ||
    password.length > 1024 ||
    !email.includes("@") ||
    !password
  ) {
    redirect(LOGIN_ERROR_PATH);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) redirect(LOGIN_ERROR_PATH);

  // A valid Supabase session alone does not grant access to the Owner portal.
  const actor = await getServerActorContext().catch(() => null);
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    await supabase.auth.signOut();
    redirect(LOGIN_ERROR_PATH);
  }

  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_COOKIE_NAME)?.value;
  if (isGuestToken(guestToken)) {
    const service = createGuestServiceClient();
    if (service) {
      try {
        await service.from("guest_visits").update({ revoked_at: new Date().toISOString() })
          .eq("token_hash", guestTokenHash(guestToken)).is("revoked_at", null);
      } catch {
        // Clearing the browser cookie still separates the verified Owner session.
      }
    }
  }
  cookieStore.delete(GUEST_COOKIE_NAME);
  redirect("/owner");
}

export async function signOutOwner(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/owner/login");
}
