import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../workspace-client", () => ({ OrdersWorkspace: () => null }));
import SchedulePage from "./page";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor: ActorContext = { authUserId: workspaceId, profileId: workspaceId, platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "OWNER", role: "MANAGER" } };
describe("schedule page authority", () => {
  it.each([null, { ...actor, membership: { ...actor.membership!, role: "ADMIN" } },
    { ...actor, membership: { ...actor.membership!, role: "TECHNICIAN" } },
    { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: null } }, { ...actor, businessReady: false }])("denies unavailable, non-manager and read-only/onboarding actors", async (denied) => {
    mocks.context.mockResolvedValue(denied ? { actor: denied, guestVisit: null } : null);
    await expect(SchedulePage({ params: Promise.resolve({ workspaceId }) })).rejects.toThrow("NOT_FOUND");
  });
  it.each([null, { id: workspaceId }])("uses the same guarded schedule presentation for formal/Guest Manager", async (guestVisit) => {
    mocks.context.mockResolvedValue({ actor, guestVisit });
    const page = await SchedulePage({ params: Promise.resolve({ workspaceId }) });
    expect(page.props).toMatchObject({ presentation: "schedule", canManagerReschedule: true, canAssign: false, canCreate: false, canImport: false, isGuest: Boolean(guestVisit) });
  });
});
