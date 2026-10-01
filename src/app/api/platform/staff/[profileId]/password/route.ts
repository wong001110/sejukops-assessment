import { z } from "zod";
import { resetStaffPassword } from "@/lib/services/staff-accounts/password-reset";
import { readStaffJson, requireStaffOrigin, staffApiContext, staffApiError, staffResponse } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetSchema = z.object({
  workspaceId: z.string().uuid(), expectedRevision: z.string().uuid(), requestKey: z.string().uuid(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    requireStaffOrigin(request);
    const context = await staffApiContext();
    const { profileId } = await params;
    const input = resetSchema.parse(await readStaffJson(request));
    return staffResponse(await resetStaffPassword(context, input.workspaceId, profileId, input.expectedRevision, input.requestKey));
  } catch (error) { return staffApiError(error); }
}
