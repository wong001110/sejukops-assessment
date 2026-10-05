import { describe, expect, it } from "vitest";

import { canUseKnowledgeAi, hasActorPermission, type ActorContext } from "./actor-policy";

const demoAdmin: ActorContext = {
  authUserId: "visitor-auth",
  profileId: "visitor-profile",
  isAnonymous: true,
  platformRole: "USER",
  membership: {
    workspaceId: "demo",
    kind: "DEMO",
    role: "ADMIN",
  },
};

describe("actor permission boundary", () => {
  it("allows technician cited knowledge without granting native or order AI", () => {
    const technician: ActorContext = { ...demoAdmin, membership: { workspaceId: "demo", kind: "DEMO", role: "TECHNICIAN" } };
    expect(canUseKnowledgeAi(technician)).toBe(true);
    expect(hasActorPermission(technician, "ai:use")).toBe(false);
    expect(canUseKnowledgeAi({ ...technician, businessReady: false })).toBe(false);
    expect(canUseKnowledgeAi({ ...technician, membership: undefined })).toBe(false);
    expect(canUseKnowledgeAi({ ...technician, preview: { readOnly: true, effectiveEmployeeProfileId: "another" } })).toBe(false);
    expect(canUseKnowledgeAi({ ...technician, membership: { workspaceId: "owner", kind: "OWNER", role: "TECHNICIAN" } })).toBe(false);
  });
  it("keeps platform settings and diagnostics out of a Demo Admin persona", () => {
    expect(hasActorPermission(demoAdmin, "order:create")).toBe(true);
    expect(hasActorPermission(demoAdmin, "ai_config:manage")).toBe(false);
    expect(hasActorPermission(demoAdmin, "diagnostics:view")).toBe(false);
  });

  it("uses the workspace role for business actions even for a Super Admin", () => {
    const ownerManager: ActorContext = {
      ...demoAdmin,
      isAnonymous: false,
      platformRole: "SUPER_ADMIN",
      membership: { workspaceId: "owner", kind: "OWNER", role: "MANAGER" },
    };

    expect(hasActorPermission(ownerManager, "ai_config:manage")).toBe(true);
    expect(hasActorPermission(ownerManager, "review:approve")).toBe(true);
    expect(hasActorPermission(ownerManager, "order:assign")).toBe(false);
  });

  it("does not infer business membership from platform privilege", () => {
    const actor: ActorContext = {
      authUserId: demoAdmin.authUserId,
      profileId: demoAdmin.profileId,
      isAnonymous: false,
      platformRole: "SUPER_ADMIN",
    };

    expect(hasActorPermission(actor, "ai_config:view")).toBe(true);
    expect(hasActorPermission(actor, "order:view")).toBe(false);
  });

  it("refuses Owner business access to an anonymous identity", () => {
    const forgedOwner: ActorContext = {
      ...demoAdmin,
      membership: { workspaceId: "owner", kind: "OWNER", role: "ADMIN" },
    };

    expect(hasActorPermission(forgedOwner, "order:view")).toBe(false);
  });
});
