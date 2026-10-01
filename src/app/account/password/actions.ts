"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { staffPasswordChangeSchema } from "@/domain/staff/contracts";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createGuestServiceClient } from "@/lib/auth/guest-session";
import { staffSessionStatusSchema } from "@/lib/auth/staff-session-status";
import { z } from "zod";

export type StaffPasswordState = Readonly<{ status: "idle" | "invalid" | "failed" | "changed" }>;

export async function changeStaffPassword(_previous: StaffPasswordState, formData: FormData): Promise<StaffPasswordState> {
  const parsed = staffPasswordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmation"),
  });
  if (!parsed.success) return { status: "invalid" };
  const actor = await getServerActorContext().catch(() => null);
  if (!actor || actor.isAnonymous || actor.platformRole !== "USER" || !actor.staff || !actor.staff.sessionAllowed) {
    redirect("/login?error=session");
  }
  const client = await createServerSupabaseClient();
  const userResult = await client.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user?.email || user.id !== actor.authUserId || user.is_anonymous) redirect("/login?error=session");
  const service = createGuestServiceClient();
  if (!service) return { status: "failed" };
  const config = getSupabasePublicConfig();
  const verification = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const finalProof = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false,persistSession: false,detectSessionInUrl: false },
  });
  // Fixed stage names are safe server diagnostics; never log Auth errors,
  // form values, identities, tokens, claims or password fingerprints.
  let stage = "current-password-proof";
  const failed = (): StaffPasswordState => { console.warn(`[staff-password] setup failed at ${stage}`); return { status: "failed" }; };
  try {
    const proof = await verification.auth.signInWithPassword({ email: user.email, password: parsed.data.currentPassword });
    if (proof.error || proof.data.user?.id !== actor.authUserId || !proof.data.session) return failed();
    stage = "password-update";
    const updated = await verification.auth.updateUser({
      current_password: parsed.data.currentPassword, password: parsed.data.newPassword,
    });
    if (updated.error) return failed();
    stage = "updated-session-status";
    const statusResult = await verification.rpc("staff_session_status");
    const status = staffSessionStatusSchema.safeParse(statusResult.data);
    if (statusResult.error || !status.success || !status.data.isManaged || !status.data.sessionAllowed ||
        status.data.authRevision !== actor.staff.authRevision) return failed();
    // The private claim binds the Auth password version BEFORE proving the
    // desired password. A concurrent reset cannot be accepted by completion.
    stage = "password-claim";
    const claimResult = await service.rpc("staff_issue_password_claim", {
      p_auth_user_id: actor.authUserId,p_expected_revision: actor.staff.authRevision,
      p_actor_session_id: status.data.sessionId,
    });
    const claim = z.object({ claimId: z.string().uuid(),expiresAt: z.string() }).strict().safeParse(claimResult.data);
    if (claimResult.error || !claim.success) return failed();
    stage = "new-password-proof";
    const finalSignIn = await finalProof.auth.signInWithPassword({ email: user.email,password: parsed.data.newPassword });
    if (finalSignIn.error || finalSignIn.data.user?.id !== actor.authUserId || !finalSignIn.data.session) return failed();
    stage = "proof-session-status";
    const finalStatusResult = await finalProof.rpc("staff_session_status");
    const finalStatus = staffSessionStatusSchema.safeParse(finalStatusResult.data);
    if (finalStatusResult.error || !finalStatus.success || !finalStatus.data.sessionAllowed ||
        !finalStatus.data.isManaged || finalStatus.data.authRevision !== actor.staff.authRevision) return failed();
    stage = "password-completion";
    const completion = await service.rpc("staff_complete_password_change", {
      p_auth_user_id: actor.authUserId,
      p_expected_revision: actor.staff.authRevision,
      p_actor_session_id: finalStatus.data.sessionId,
      p_claim_id: claim.data.claimId,
    });
    if (completion.error) return failed();
    // Completion advances the DB cutoff; all sessions, including this one,
    // must sign in again. Business access never depends on the local UI state.
    await client.auth.signOut({ scope: "local" });
    return { status: "changed" };
  } catch {
    return failed();
  } finally {
    await verification.auth.signOut({ scope: "local" }).catch(() => {});
    await finalProof.auth.signOut({ scope: "local" }).catch(() => {});
  }
}
