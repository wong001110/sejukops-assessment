import { describe, expect, it } from "vitest";

import { resolveActorContext, type MembershipRecord, type ProfileRecord } from "./actor-resolution";

const user = { id: "auth-1", isAnonymous: true };
const profile: ProfileRecord = {
  id: "profile-1",
  authUserId: user.id,
  platformRole: "SUPER_ADMIN",
  active: true,
};
const demoMembership: MembershipRecord = {
  profileId: profile.id,
  workspaceId: "demo-1",
  role: "ADMIN",
  active: true,
  workspaceKind: "DEMO",
  workspaceActive: true,
};

describe("server actor resolution", () => {
  it("binds the profile to the verified Auth user and ignores anonymous platform privilege", () => {
    expect(resolveActorContext(user, { ...profile, authUserId: "someone-else" })).toBeNull();
    expect(resolveActorContext(user, profile)?.platformRole).toBe("USER");
  });

  it("requires the selected workspace to match an active membership", () => {
    expect(resolveActorContext(user, profile, "owner-1", demoMembership)).toBeNull();
    expect(resolveActorContext(user, profile, "demo-1", { ...demoMembership, active: false })).toBeNull();
    expect(resolveActorContext(user, profile, "demo-1", { ...demoMembership, workspaceActive: false })).toBeNull();
    expect(resolveActorContext(user, profile, "demo-1", { ...demoMembership, profileId: "other" })).toBeNull();
    expect(resolveActorContext(user, profile, "demo-1", demoMembership)?.membership?.role).toBe("ADMIN");
  });

  it("never resolves an anonymous Owner membership", () => {
    expect(resolveActorContext(user, profile, "owner-1", {
      ...demoMembership,
      workspaceId: "owner-1",
      workspaceKind: "OWNER",
    })).toBeNull();
  });
});
