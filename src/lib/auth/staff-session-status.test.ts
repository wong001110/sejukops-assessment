import { describe, expect, it } from "vitest";
import { isStaffBusinessReady, staffSessionStatusSchema } from "./staff-session-status";
import { resolveActorContext } from "./actor-resolution";
import { hasActorPermission } from "./actor-policy";

const revision = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const managed = { isManaged: true, passwordChangeRequired: false, sessionAllowed: true, authRevision: revision, sessionId };

describe("staff onboarding and session policy", () => {
  it("requires both readiness and an allowed current session", () => {
    expect(isStaffBusinessReady(managed)).toBe(true);
    expect(isStaffBusinessReady({ ...managed, passwordChangeRequired: true })).toBe(false);
    expect(isStaffBusinessReady({ ...managed, sessionAllowed: false })).toBe(false);
  });
  it("rejects incomplete or client-shaped status instead of treating it as an ordinary user", () => {
    expect(staffSessionStatusSchema.safeParse({ ...managed, authRevision: null }).success).toBe(false);
    expect(staffSessionStatusSchema.safeParse({ ...managed, sessionId: null }).success).toBe(false);
    expect(staffSessionStatusSchema.safeParse({ ...managed, isManaged: undefined }).success).toBe(false);
    expect(staffSessionStatusSchema.safeParse({ ...managed, role: "ADMIN" }).success).toBe(false);
  });
  it("retains a limited actor for password onboarding but cannot resolve business membership", () => {
    const user = { id: "auth", isAnonymous: false };
    const profile = { id: "profile", authUserId: "auth", active: true, platformRole: "USER" as const, businessReady: false };
    const actor = resolveActorContext(user, profile)!;
    expect(actor).toMatchObject({ profileId: "profile", businessReady: false });
    expect(hasActorPermission(actor, "order:view")).toBe(false);
    expect(resolveActorContext(user, profile, "workspace", {
      profileId: "profile", workspaceId: "workspace", role: "ADMIN", active: true,
      workspaceKind: "OWNER", workspaceActive: true,
    })).toBeNull();
  });
  it("does not grant any permission to a not-ready actor even if an adapter supplies membership", () => {
    const actor = { authUserId: "auth", profileId: "profile", isAnonymous: false, platformRole: "SUPER_ADMIN" as const,
      businessReady: false, membership: { workspaceId: "workspace", kind: "OWNER" as const, role: "ADMIN" as const } };
    for (const permission of ["order:create", "order:view", "ai:use", "ai_config:manage"] as const) {
      expect(hasActorPermission(actor, permission)).toBe(false);
    }
  });
  it("limits Owner preview to role-appropriate reads and keeps actual Owner identity", () => {
    const actor = { authUserId: "owner-auth", profileId: "owner-profile", isAnonymous: false,
      platformRole: "SUPER_ADMIN" as const, businessReady: true,
      preview: { readOnly: true as const, effectiveEmployeeProfileId: "technician-profile" },
      membership: { workspaceId: "workspace", kind: "OWNER" as const, role: "TECHNICIAN" as const } };
    expect(hasActorPermission(actor, "job:view_assigned")).toBe(true);
    for (const permission of ["job:start_assigned", "job:complete_assigned", "ai:use", "order:assign", "order:create"] as const) {
      expect(hasActorPermission(actor, permission)).toBe(false);
    }
    expect(actor.authUserId).toBe("owner-auth");
    expect(actor.profileId).toBe("owner-profile");
  });
});
