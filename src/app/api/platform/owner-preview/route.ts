import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { ownerPreviewInputSchema, ownerPreviewOptionsSchema, ownerPreviewStatusSchema } from "@/domain/staff/owner-preview-contracts";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { StaffAccountError } from "@/lib/services/staff-accounts/service";
import { readStaffJson } from "../staff/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
class PreviewError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
async function caller() {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN" || actor.businessReady === false || !actor.sessionId) throw new PreviewError(403, "An authenticated Owner session is required.");
  // These RPCs require the actual caller's JWT; never use a service-role client.
  return createServerSupabaseClient();
}
function fail(error: unknown) {
  const status = error instanceof PreviewError || error instanceof StaffAccountError ? error.status : error instanceof ZodError ? 400 : 503;
  return response({ error: { code: status === 403 ? "PREVIEW_FORBIDDEN" : status === 400 ? "PREVIEW_INVALID_INPUT" : "PREVIEW_UNAVAILABLE", message: error instanceof PreviewError ? error.message : status === 400 ? "Choose a valid perspective and employee." : "Preview is unavailable or expired. Return to Owner and try again." } }, status);
}
export async function GET(request: Request) {
  try {
    const client = await caller();
    const workspaceId = z.string().uuid().parse(new URL(request.url).searchParams.get("workspaceId"));
    const options = await client.rpc("owner_preview_options", { p_workspace_id: workspaceId });
    if (options.error) throw new PreviewError(403, "An active Owner workspace is required.");
    const status = await client.rpc("owner_preview_status", { p_workspace_id: workspaceId });
    if (status.error) throw new PreviewError(409, "Preview is unavailable or expired. Return to Owner and try again.");
    const parsedOptions = ownerPreviewOptionsSchema.safeParse(options.data);
    const parsedStatus = ownerPreviewStatusSchema.nullable().safeParse(status.data);
    if (!parsedOptions.success || !parsedStatus.success) throw new PreviewError(503, "Preview options could not be verified. Return to Owner and retry.");
    return response({ ...parsedOptions.data, preview: parsedStatus.data });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) throw new PreviewError(403, "This preview request is not permitted.");
    const client = await caller();
    const input = ownerPreviewInputSchema.parse(await readStaffJson(request));
    const result = await client.rpc("owner_preview_set", { p_workspace_id: input.workspaceId, p_role: input.role, p_employee_profile_id: input.employeeProfileId });
    if (result.error) throw new PreviewError(409, "The selected employee or workspace changed. Refresh and try again.");
    const parsed = ownerPreviewStatusSchema.safeParse(result.data);
    if (!parsed.success) throw new PreviewError(503, "Preview could not be verified. Return to Owner and retry.");
    return response({ preview: parsed.data });
  } catch (error) { return fail(error); }
}
export async function DELETE(request: Request) {
  try {
    if (!isSameOriginRequest(request)) throw new PreviewError(403, "This preview request is not permitted.");
    const client = await caller();
    const result = await client.rpc("owner_preview_exit");
    if (result.error) throw new PreviewError(503, "Preview could not be cleared. Retry Return to Owner.");
    return response({ preview: null });
  } catch (error) { return fail(error); }
}
