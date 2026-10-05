import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PlatformDataContext } from "@/lib/supabase/platform-server";
import { StaffAccountError, staffOwnerParameters, staffRpc } from "./service";

const accountSchema = z.object({
  profileId: z.string().uuid(), name: z.string(), email: z.string().email(), role: z.enum(["ADMIN", "MANAGER", "TECHNICIAN"]),
  branchCode: z.string().nullable(), active: z.boolean(), passwordChangeRequired: z.boolean(), authRevision: z.string().uuid(),
}).strict();
const resetSchema = z.object({ state: z.literal("RESET"), account: accountSchema }).strict();
const reservationSchema = z.object({
  state: z.literal("RESERVED"), operationId: z.string().uuid(), claimToken: z.string().uuid(),
  targetAuthUserId: z.string().uuid(), targetProfileId: z.string().uuid(), resetRevision: z.string().uuid(),
}).strict();
const resetMarker = "sejukops_staff_password_reset";

function unavailable(message = "The password reset could not be confirmed. Retry the same request.") {
  return new StaffAccountError("STAFF_UNAVAILABLE", 503, message);
}

/** Resets are deliberately reconciled without retaining or replaying a password. */
export async function resetStaffPassword(
  context: PlatformDataContext,
  workspaceId: string,
  profileId: string,
  expectedRevision: string,
  requestKey: string,
) {
  const parsedWorkspaceId = z.string().uuid().parse(workspaceId);
  const owner = staffOwnerParameters(context.actor, parsedWorkspaceId);
  const parsedProfileId = z.string().uuid().parse(profileId);
  const parsedRevision = z.string().uuid().parse(expectedRevision);
  const parsedRequestKey = z.string().uuid().parse(requestKey);
  const reservation = await staffRpc(context.supabase, "staff_reserve_password_reset", {
    ...owner, p_profile_id: parsedProfileId, p_expected_revision: parsedRevision, p_request_key: parsedRequestKey,
  });
  const completed = resetSchema.safeParse(reservation);
  if (completed.success) return { status: "ALREADY_RESET" as const, account: completed.data.account, credential: null };
  const parsedOperation = reservationSchema.safeParse(reservation);
  if (!parsedOperation.success) throw unavailable();
  const operation = parsedOperation.data;
  if (operation.operationId !== parsedRequestKey || operation.targetProfileId !== parsedProfileId) {
    throw unavailable("The reserved password reset could not be matched safely. Retry the same request.");
  }

  let password: string | undefined;
  try {
    const firstRead = await context.supabase.auth.admin.getUserById(operation.targetAuthUserId);
    if (firstRead.error || !firstRead.data.user || firstRead.data.user.id !== operation.targetAuthUserId || firstRead.data.user.is_anonymous) {
      throw unavailable();
    }
    const existingMarker = firstRead.data.user.app_metadata?.[resetMarker];
    if (existingMarker === operation.operationId) {
      const account = parseFinalAccount(await finalize(context, parsedWorkspaceId, parsedProfileId, parsedRequestKey, operation.claimToken));
      return { status: "ALREADY_RESET" as const, account, credential: null };
    }

    password = randomBytes(32).toString("base64url");
    let authUpdateSucceeded = false;
    try {
      const updated = await context.supabase.auth.admin.updateUserById(operation.targetAuthUserId, {
        password,
        app_metadata: { ...firstRead.data.user.app_metadata, [resetMarker]: operation.operationId },
      });
      authUpdateSucceeded = !updated.error && updated.data.user?.id === operation.targetAuthUserId &&
        updated.data.user.app_metadata?.[resetMarker] === operation.operationId;
    } catch {
      // The request may have reached Auth. Read the marker back before deciding.
    }

    const confirmed = await context.supabase.auth.admin.getUserById(operation.targetAuthUserId);
    if (confirmed.error || confirmed.data.user?.id !== operation.targetAuthUserId ||
        confirmed.data.user.is_anonymous || confirmed.data.user.app_metadata?.[resetMarker] !== operation.operationId) {
      throw unavailable();
    }
    const account = parseFinalAccount(await finalize(context, parsedWorkspaceId, parsedProfileId, parsedRequestKey, operation.claimToken));
    if (account.authRevision !== operation.resetRevision || !account.passwordChangeRequired) {
      throw new StaffAccountError("STAFF_CONFLICT", 409, "The account changed during password reset. Refresh and review its current state.");
    }
    if (!authUpdateSucceeded) {
      return { status: "ALREADY_RESET" as const, account, credential: null };
    }
    const email = confirmed.data.user.email;
    if (!email) throw unavailable();
    return { status: "RESET" as const, account, credential: { email, password } };
  } catch (error) {
    if (error instanceof StaffAccountError) throw error;
    throw unavailable();
  } finally {
    password = undefined;
  }
}

function parseFinalAccount(value: unknown) {
  const account = accountSchema.safeParse(value);
  if (!account.success) throw unavailable();
  return account.data;
}

async function finalize(context: PlatformDataContext, workspaceId: string, profileId: string,
  requestKey: string, claimToken: string): Promise<unknown> {
  return staffRpc(context.supabase, "staff_finalize_password_reset", {
    ...staffOwnerParameters(context.actor, workspaceId), p_profile_id: profileId,
    p_request_key: requestKey, p_claim_token: claimToken,
  });
}
