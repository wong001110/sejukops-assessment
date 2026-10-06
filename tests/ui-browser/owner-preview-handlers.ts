import { delay, HttpResponse } from "msw";
import type { OwnerPreviewStatus } from "../../src/domain/staff/owner-preview-contracts";
import { realisticTechnicians, realisticBranches } from "../fixtures/ui/realistic-workspace";
import { ids, techniciansFixture } from "../fixtures/ui/workspace";
const employeeId = techniciansFixture[0].profile_id;
const technicians = [{ profileId: employeeId, name: "Synthetic Preview Technician", branchCode: "MOCK_NORTH" }];
let preview: OwnerPreviewStatus | null = null;
let exits = 0;
export function getMockOwnerPreview() { return preview; }
function publish() { window.dispatchEvent(new CustomEvent("mock-owner-preview", { detail: preview })); }
export function resetOwnerPreviewMock(scenario: string) {
  exits = 0;
  preview = scenario === "preview-expired" ? { previewId: ids.order, role: "TECHNICIAN", effectiveEmployeeProfileId: employeeId, effectiveEmployeeName: technicians[0].name, readOnly: true } : null;
  publish();
}
export async function resolveOwnerPreviewMock(request: Request, scenario: string) {
  if (new URL(request.url).pathname !== "/api/platform/owner-preview") return null;
  const options = scenario === "realistic" ? realisticTechnicians.map(t=>({profileId:t.profile_id,name:t.name,branchCode:realisticBranches.find(b=>b.id===t.branch_id)!.code})) : technicians;
  const fail = (status: number, message: string) => HttpResponse.json({ error: { code: "MOCK_PREVIEW_UNAVAILABLE", message } }, { status });
  if (request.method === "GET") {
    if (scenario === "preview-error" || scenario === "preview-expired") { return fail(409, "MOCK preview unavailable or expired. Return to Owner and try again."); }
    return HttpResponse.json({ technicians: scenario === "preview-empty" ? [] : options, preview });
  }
  if (request.method === "POST") {
    const body = await request.json();
    await delay(600);
    if (!["ADMIN", "MANAGER", "TECHNICIAN"].includes(body.role) || (body.role === "TECHNICIAN" && !options.some(t=>t.profileId===body.employeeProfileId)) || (body.role !== "TECHNICIAN" && body.employeeProfileId !== null)) { return fail(400, "MOCK choose an actual Technician employee."); }
    preview = { previewId: ids.order, role: body.role, effectiveEmployeeProfileId: body.employeeProfileId, effectiveEmployeeName: body.role === "TECHNICIAN" ? options.find(t=>t.profileId===body.employeeProfileId)?.name ?? null : null, readOnly: true }; publish(); return HttpResponse.json({ preview });
  }
  if (request.method === "DELETE") {
    if (scenario === "preview-exit-error" && exits++ === 0) { return fail(503, "MOCK exit interrupted. Retry Return to Owner."); }
    preview = null; publish(); return HttpResponse.json({ preview: null });
  }
  return fail(405, "MOCK unsupported preview method.");
}
