import { z } from "zod";
import { confirmStaffImport } from "@/lib/services/staff-accounts/import";
import { readStaffJson,requireStaffOrigin,staffApiContext,staffApiError,staffResponse } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({workspaceId:z.string().uuid(),importId:z.string().uuid(),retryFailed:z.boolean().optional()}).strict();
export async function POST(request: Request) {
  try {
    requireStaffOrigin(request);
    const context = await staffApiContext();
    const input = schema.parse(await readStaffJson(request));
    return staffResponse(await confirmStaffImport(context,input.workspaceId,input.importId,input.retryFailed));
  } catch (error) { return staffApiError(error); }
}
