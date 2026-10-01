import { z } from "zod";
import { staffAccountInputSchema } from "@/domain/staff/contracts";
import { createStaffAccount, listStaffAccounts } from "@/lib/services/staff-accounts/service";
import { readStaffJson,requireStaffOrigin,staffApiContext,staffApiError,staffResponse } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const createSchema = z.object({ workspaceId: z.string().uuid(),requestKey: z.string().uuid(),input: staffAccountInputSchema }).strict();

export async function GET(request: Request) {
  try {
    const context = await staffApiContext();
    const workspaceId = z.string().uuid().parse(new URL(request.url).searchParams.get("workspaceId"));
    return staffResponse(await listStaffAccounts(context,workspaceId));
  } catch (error) { return staffApiError(error); }
}
export async function POST(request: Request) {
  try {
    requireStaffOrigin(request);
    const context = await staffApiContext();
    const input = createSchema.parse(await readStaffJson(request));
    return staffResponse(await createStaffAccount(context,input.workspaceId,input.requestKey,input.input),201);
  } catch (error) { return staffApiError(error); }
}
