import { z } from "zod";
import { STAFF_IMPORT_MAX_BYTES } from "@/domain/staff/contracts";
import { previewStaffImport } from "@/lib/services/staff-accounts/import";
import { listStaffAccounts,StaffAccountError } from "@/lib/services/staff-accounts/service";
import { parseStaffImportWorkbook } from "@/lib/services/staff-accounts/spreadsheet";
import { readStaffBody,requireStaffOrigin,staffApiContext,staffApiError,staffResponse } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireStaffOrigin(request);
    const context = await staffApiContext();
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Upload the .xlsx template.");
    const bytes = await readStaffBody(request,STAFF_IMPORT_MAX_BYTES+16_384);
    let form: FormData;
    try { form = await new Response(Uint8Array.from(bytes),{headers:{"Content-Type":contentType}}).formData(); }
    catch { throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Upload the .xlsx template."); }
    if ([...form.keys()].length !== 2 || form.getAll("workspaceId").length !== 1 || form.getAll("file").length !== 1) {
      throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Provide one workspace and one workbook.");
    }
    const workspaceId = z.string().uuid().parse(form.get("workspaceId"));
    await listStaffAccounts(context,workspaceId);
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size < 1) {
      throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Use a non-empty .xlsx workbook.");
    }
    if (file.size > STAFF_IMPORT_MAX_BYTES) throw new StaffAccountError("STAFF_PAYLOAD_TOO_LARGE",413,"The workbook must be 1 MiB or smaller.");
    let preview;
    try { preview = await parseStaffImportWorkbook(new Uint8Array(await file.arrayBuffer())); }
    catch { throw new StaffAccountError("STAFF_INVALID_INPUT",400,"Use the Staff template without formulas, macros, external links or encrypted content."); }
    return staffResponse(await previewStaffImport(context,workspaceId,preview));
  } catch (error) { return staffApiError(error); }
}
