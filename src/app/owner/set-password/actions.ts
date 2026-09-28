"use server";

import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ERROR_PATH = "/owner/set-password?error=invalid";

export async function setOwnerPassword(formData: FormData): Promise<void> {
  const password = formData.get("password");
  const confirmation = formData.get("confirmation");
  if (
    typeof password !== "string" ||
    typeof confirmation !== "string" ||
    password.length < 12 ||
    password.length > 1024 ||
    password !== confirmation
  ) {
    redirect(ERROR_PATH);
  }

  const actor = await getServerActorContext().catch(() => null);
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login?error=invalid");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(ERROR_PATH);

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) throw new Error("Owner password was updated but sign-out failed");
  redirect("/owner/login");
}
