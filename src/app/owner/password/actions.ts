"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type PasswordChangeState = Readonly<{ status: "idle" | "invalid" | "failed" | "changed" }>;

export async function changeOwnerPassword(
  _previous: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmation = formData.get("confirmation");
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" ||
      typeof confirmation !== "string" || currentPassword.length < 1 ||
      currentPassword.length > 1024 || newPassword.length < 12 ||
      newPassword.length > 128 || newPassword !== confirmation ||
      newPassword === currentPassword) {
    return { status: "invalid" };
  }

  const actor = await getServerActorContext().catch(() => null);
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user || user.id !== actor.authUserId ||
      user.is_anonymous === true || !user.email) {
    redirect("/owner/login");
  }

  // Verify the old password independently even when optional project-side
  // current-password enforcement is disabled. This client never uses cookies.
  try {
    const config = getSupabasePublicConfig();
    const verification = createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const proof = await verification.auth.signInWithPassword({
      email: user.email, password: currentPassword,
    });
    const verified = !proof.error && proof.data.user?.id === actor.authUserId &&
      !!proof.data.session;
    if (proof.data.session) {
      const { error: cleanupError } = await verification.auth.signOut({ scope: "local" });
      if (cleanupError) return { status: "failed" };
    }
    if (!verified) return { status: "failed" };

    const { error } = await supabase.auth.updateUser({
      current_password: currentPassword,
      password: newPassword,
    });
    return { status: error ? "failed" : "changed" };
  } catch {
    return { status: "failed" };
  }
}
