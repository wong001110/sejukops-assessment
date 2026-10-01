import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { getServerActorContext } from "./server-actor";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

describe("server actor workspace resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a valid five-part UUID and resolves a verified active membership", async () => {
    const rows: Record<string, unknown> = {
      profiles: { id: PROFILE, auth_user_id: USER, platform_role: "USER", active: true },
      workspace_memberships: { profile_id: PROFILE, workspace_id: WORKSPACE, role: "ADMIN", active: true },
      workspaces: { id: WORKSPACE, kind: "DEMO", active: true },
    };
    const from = vi.fn((table: string) => {
      const builder = {
        select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: rows[table], error: null }),
      };
      builder.select.mockReturnValue(builder);
      builder.eq.mockReturnValue(builder);
      return builder;
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER, is_anonymous: true } }, error: null }) },
      from,
      rpc: vi.fn().mockResolvedValue({ data: {
        isManaged: false, passwordChangeRequired: false, sessionAllowed: true,
        authRevision: null, sessionId: null,
      }, error: null }),
    });

    const actor = await getServerActorContext(WORKSPACE);
    expect(actor?.membership).toEqual({ workspaceId: WORKSPACE, kind: "DEMO", role: "ADMIN" });
    expect(from).toHaveBeenCalledWith("workspaces");
  });

  it("rejects malformed workspace IDs before opening Auth", async () => {
    expect(await getServerActorContext("not-a-uuid")).toBeNull();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
