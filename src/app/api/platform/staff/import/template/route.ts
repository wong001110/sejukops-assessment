import { z } from "zod";
import { listStaffAccounts } from "@/lib/services/staff-accounts/service";
import { createStaffImportTemplate } from "@/lib/services/staff-accounts/spreadsheet";
import { staffApiContext,staffApiError } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const context = await staffApiContext();
    const workspaceId = z.string().uuid().parse(new URL(request.url).searchParams.get("workspaceId"));
    await listStaffAccounts(context,workspaceId);
    const workbook = await createStaffImportTemplate();
    return new Response(Uint8Array.from(workbook),{headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sejukops-staff-template.xlsx"',
      "Cache-Control": "no-store, private",Vary: "Cookie",
    }});
  } catch (error) { return staffApiError(error); }
}
