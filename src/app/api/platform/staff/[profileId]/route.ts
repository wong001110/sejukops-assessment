import { z } from "zod";
import { STAFF_ROLES } from "@/domain/staff/contracts";
import { updateStaffAccount } from "@/lib/services/staff-accounts/service";
import { readStaffJson,requireStaffOrigin,staffApiContext,staffApiError,staffResponse } from "../_shared";
export const runtime = "nodejs";
const updateSchema = z.object({ workspaceId: z.string().uuid(),expectedRevision: z.string().uuid(),role: z.enum(STAFF_ROLES),branchCode: z.string().nullable(),active: z.boolean() }).strict();
export async function PATCH(request: Request,{ params }: { params: Promise<{ profileId: string }> }) {
  try {
    requireStaffOrigin(request);
    const context = await staffApiContext();
    const { profileId } = await params;
    const input = updateSchema.parse(await readStaffJson(request));
    return staffResponse({ account: await updateStaffAccount(context,input.workspaceId,profileId,input.expectedRevision,input) });
  } catch (error) { return staffApiError(error); }
}
