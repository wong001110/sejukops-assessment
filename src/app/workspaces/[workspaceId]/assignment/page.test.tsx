import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./workspace", () => ({ default: () => null }));
import AssignmentPage from "./page";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = { authUserId: workspaceId, profileId: workspaceId, platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const params = Promise.resolve({ workspaceId });
describe("formal Admin assignment page boundary", () => {
  it.each([null, { actor, guestVisit: { id: workspaceId } },
    { actor: { ...actor, membership: { ...actor.membership, role: "MANAGER" } } },
    { actor: { ...actor, membership: { ...actor.membership, role: "TECHNICIAN" } } },
    { actor: { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: null } } },
    { actor: { ...actor, businessReady: false } }])("denies Guest, other roles, preview, onboarding and missing actors", async context => {
    mocks.context.mockResolvedValue(context);
    await expect(AssignmentPage({ params })).rejects.toThrow("NOT_FOUND");
  });
  it("opens for a permitted formal Admin", async () => {
    mocks.context.mockResolvedValue({ actor, guestVisit: null });
    expect((await AssignmentPage({ params })).key).toContain(workspaceId);
  });
});
