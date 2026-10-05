import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { readWorkspaceTechnicians } from "./technicians";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const actor: ActorContext = { authUserId: id, profileId: id, isAnonymous: false, platformRole: "USER",
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
describe("shared scoped technician read", () => {
  it("fixes workspace/active filters, bound and projection", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.limit.mockResolvedValue({ data: [{ id, branch_id: id, profile_id: id }], error: null });
    const from = vi.fn(() => query);
    expect(await readWorkspaceTechnicians(actor, { from } as unknown as SupabaseClient, workspaceId)).toEqual([{ id, branch_id: id, profile_id: id }]);
    expect(query.eq.mock.calls).toEqual([["workspace_id", workspaceId], ["active", true]]); expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.select).toHaveBeenCalledWith("id,branch_id,profile_id");
  });
  it.each([
    { ...actor, membership: { workspaceId, kind: "OWNER" as const, role: "MANAGER" as const } },
    { ...actor, preview: { readOnly: true as const, effectiveEmployeeProfileId: null } },
    { ...actor, businessReady: false },
  ])("denies role/readiness/preview before any query", async (denied) => {
    const from = vi.fn(); await expect(readWorkspaceTechnicians(denied, { from } as unknown as SupabaseClient, workspaceId)).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});
