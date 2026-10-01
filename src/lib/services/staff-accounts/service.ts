import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { STAFF_ROLES, staffAccountInputSchema, type StaffAccountInput, type StaffAccountList, type StaffAccountSummary, type StaffCreateResult } from "@/domain/staff/contracts";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { createPlatformDataContext, type PlatformDataContext } from "@/lib/supabase/platform-server";

const accountSchema = z.object({
  profileId: z.string().uuid(), name: z.string(), email: z.string().email(), role: z.enum(STAFF_ROLES),
  branchCode: z.string().nullable(), active: z.boolean(), passwordChangeRequired: z.boolean(), authRevision: z.string().uuid(),
}).strict();
const listSchema = z.object({ accounts: z.array(accountSchema), branches: z.array(z.object({ code: z.string(), name: z.string() }).strict()) }).strict();
const reservationSchema = z.object({ state: z.literal("RESERVED"), operationId: z.string().uuid(), claimToken: z.string().uuid(),
  targetAuthUserId: z.string().uuid(), targetProfileId: z.string().uuid() }).strict();

export class StaffAccountError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "StaffAccountError"; }
}

export async function getStaffManagementContext(workspaceId: string): Promise<PlatformDataContext> {
  if (!z.string().uuid().safeParse(workspaceId).success) throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Choose a valid workspace.");
  const context = await createPlatformDataContext("ai_config:manage");
  if (!context.actor.sessionId) throw new StaffAccountError("STAFF_OWNER_REQUIRED",403,"Sign in again before managing accounts.");
  return context;
}

export function staffOwnerParameters(actor: ActorContext, workspaceId: string) {
  if (actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN" || actor.businessReady === false || !actor.sessionId) {
    throw new StaffAccountError("STAFF_OWNER_REQUIRED",403,"An authenticated Owner is required.");
  }
  return { p_owner_auth_user_id: actor.authUserId, p_owner_session_id: actor.sessionId, p_workspace_id: workspaceId };
}

export async function staffRpc(client: SupabaseClient, name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name,parameters);
  if (!result.error) return result.data;
  const message = result.error.message ?? "";
  if (/STAFF_(?:OWNER_REQUIRED|WORKSPACE_FORBIDDEN|PASSWORD_COMPLETION_FORBIDDEN)/.test(message)) {
    throw new StaffAccountError("STAFF_FORBIDDEN",403,"This account operation is unavailable.");
  }
  if (/STAFF_(?:STALE_ACCOUNT|REQUEST_CONFLICT|EMAIL_CONFLICT|BUSY)/.test(message)) {
    throw new StaffAccountError("STAFF_CONFLICT",409,"This request conflicts with an existing account or a newer change. Refresh and retry.");
  }
  if (/STAFF_(?:INVALID_INPUT|BRANCH_INVALID)/.test(message)) {
    throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Check the role, active branch and account fields.");
  }
  if (message.includes("STAFF_BRANCH_IN_USE")) {
    throw new StaffAccountError("STAFF_BRANCH_IN_USE",409,"This technician has order history in the current branch. Keep that branch when updating the account.");
  }
  throw new StaffAccountError("STAFF_UNAVAILABLE",503,"Account management could not finish. Retry the same operation.");
}

export async function listStaffAccounts(context: PlatformDataContext, workspaceId: string): Promise<StaffAccountList> {
  return listSchema.parse(await staffRpc(context.supabase,"staff_list",staffOwnerParameters(context.actor,workspaceId)));
}

/** A retry may reconcile only its reserved Auth UUID + server-owned marker. */
export async function createStaffAccount(context: PlatformDataContext, workspaceId: string, requestKey: string,
  input: StaffAccountInput): Promise<StaffCreateResult> {
  const canonical = staffAccountInputSchema.parse(input);
  z.string().uuid().parse(requestKey);
  const owner = staffOwnerParameters(context.actor,workspaceId);
  const reservation = await staffRpc(context.supabase,"staff_reserve_creation", { ...owner,p_request_key: requestKey,p_input: canonical });
  const existing = z.object({ state: z.literal("CREATED"),account: accountSchema }).strict().safeParse(reservation);
  if (existing.success) return { status: "ALREADY_CREATED",account: existing.data.account,credential: null };
  const operation = reservationSchema.parse(reservation);
  let password: string | undefined;
  try {
    const lookup = await context.supabase.auth.admin.getUserById(operation.targetAuthUserId);
    if (lookup.error && lookup.error.status !== 404) throw new StaffAccountError("STAFF_UNAVAILABLE",503,"Account creation could not be reconciled. Retry.");
    let authUser = lookup.data.user;
    if (!authUser) {
      password = randomBytes(24).toString("base64url");
      const created = await context.supabase.auth.admin.createUser({
        id: operation.targetAuthUserId,email: canonical.email,password,email_confirm: true,
        app_metadata: { sejukops_staff_operation: operation.operationId },
      });
      if (created.error || !created.data.user) throw new StaffAccountError("STAFF_UNAVAILABLE",503,"Account creation could not finish. Retry the same request.");
      authUser = created.data.user;
    }
    if (authUser.id !== operation.targetAuthUserId || authUser.email?.toLowerCase() !== canonical.email ||
        authUser.is_anonymous || authUser.app_metadata?.sejukops_staff_operation !== operation.operationId) {
      throw new StaffAccountError("STAFF_CONFLICT",409,"The reserved identity could not be reconciled safely.");
    }
    const account = accountSchema.parse(await staffRpc(context.supabase,"staff_finalize_creation", {
      ...owner,p_request_key: requestKey,p_claim_token: operation.claimToken,
    }));
    return { status: "CREATED",account,credential: password ? { email: canonical.email,password } : null };
  } catch (error) {
    await staffRpc(context.supabase,"staff_fail_creation", { ...owner,p_request_key: requestKey,p_claim_token: operation.claimToken }).catch(() => {});
    if (error instanceof StaffAccountError) throw error;
    throw new StaffAccountError("STAFF_UNAVAILABLE",503,"Account creation could not finish. Retry the same request.");
  } finally {
    password = undefined;
  }
}

export async function updateStaffAccount(context: PlatformDataContext, workspaceId: string, profileId: string,
  expectedRevision: string, input: { role: StaffAccountInput["role"]; branchCode: string | null; active: boolean }): Promise<StaffAccountSummary> {
  z.string().uuid().parse(profileId); z.string().uuid().parse(expectedRevision);
  const canonical = staffAccountInputSchema.parse({ name: "Validation",email: "validation@example.test",role: input.role,branchCode: input.branchCode });
  z.boolean().parse(input.active);
  return accountSchema.parse(await staffRpc(context.supabase,"staff_update_account", {
    ...staffOwnerParameters(context.actor,workspaceId),p_profile_id: profileId,p_expected_revision: expectedRevision,
    p_role: canonical.role,p_branch_code: canonical.branchCode,p_active: input.active,
  }));
}
