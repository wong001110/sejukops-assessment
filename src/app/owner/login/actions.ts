"use server";

import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";
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

  redirect("/owner");
}

export async function signOutOwner(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/owner/login");
}
