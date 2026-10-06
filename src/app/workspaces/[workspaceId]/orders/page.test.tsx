import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("../workspace-client", () => ({ OrdersWorkspace: () => null }));
import OrdersPage from "./page";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = { authUserId: workspaceId, profileId: workspaceId, platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
async function page(context: unknown) {
  mocks.context.mockResolvedValue(context);
  return OrdersPage({ params: Promise.resolve({ workspaceId }) });
}
describe("orders perspective lifecycle", () => {
  it("remounts on role changes and drops Admin controls", async () => {
    const admin = await page({ actor, guestVisit: null });
    const technician = await page({ actor: { ...actor, membership: { ...actor.membership, role: "TECHNICIAN" } }, guestVisit: null });
    expect(technician.key).not.toBe(admin.key);
    expect(technician.props).toMatchObject({ role: "TECHNICIAN", canCreate: false, canAssign: false, canUseAi: false, canAdvanceJob: true });
  });
  it("remounts between normal and employee preview scope", async () => {
    const normal = await page({ actor, guestVisit: null });
    const previewActor = { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: "employee-a" } };
    const preview = await page({ actor: previewActor, guestVisit: null });
    const other = await page({ actor: { ...previewActor, preview: { ...previewActor.preview, effectiveEmployeeProfileId: "employee-b" } }, guestVisit: null });
    expect(preview.key).not.toBe(normal.key);
    expect(other.key).not.toBe(preview.key);
    expect(preview.props).toMatchObject({ canCreate: false, canAssign: false, canImport: false, canUseAi: false });
  });
  it("remounts when the Guest visit changes in the same workspace", async () => {
    const before = await page({ actor, guestVisit: { id: "visit-a" } });
    const after = await page({ actor, guestVisit: { id: "visit-b" } });
    expect(after.key).not.toBe(before.key);
  });
});
