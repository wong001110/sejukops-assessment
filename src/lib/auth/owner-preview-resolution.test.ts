import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { resolveActorFromAuthenticatedClient } from "./server-actor";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const employeeId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const preview = { previewId: "66666666-6666-4666-8666-666666666666", role: "TECHNICIAN", effectiveEmployeeProfileId: employeeId, effectiveEmployeeName: "Synthetic Technician", readOnly: true };
function client({ platformRole = "SUPER_ADMIN", kind = "OWNER", anonymous = false, status = preview as unknown, error = null as unknown, memberActive = true } = {}) {
  const rows: Record<string, unknown> = {
    profiles: { id: profileId, auth_user_id: userId, platform_role: platformRole, active: true },
    workspace_memberships: { profile_id: profileId, workspace_id: workspaceId, role: "ADMIN", active: memberActive },
    workspaces: { id: workspaceId, kind, active: true },
  };
  const rpc = vi.fn(async (name: string) => name === "staff_session_status" ? { data: { isManaged: false, passwordChangeRequired: false, sessionAllowed: true, authRevision: null, sessionId }, error: null } : { data: status, error });
  const from = vi.fn((table: string) => { const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: rows[table], error: null }) }; query.select.mockReturnValue(query); query.eq.mockReturnValue(query); return query; });
  return { rpc, from, instance: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId, is_anonymous: anonymous } }, error: null }) }, from, rpc } as unknown as SupabaseClient };
}
describe("persisted Owner preview actor", () => {
  it("preserves actual identity and session while adopting selected employee and effective role", async () => {
    const mock = client();
    const actor = await resolveActorFromAuthenticatedClient(mock.instance, workspaceId);
    expect(actor).toMatchObject({ authUserId: userId, profileId, sessionId, platformRole: "SUPER_ADMIN", isAnonymous: false, membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" }, preview: { readOnly: true, effectiveEmployeeProfileId: employeeId, effectiveEmployeeName: preview.effectiveEmployeeName } });
    expect(mock.rpc).toHaveBeenCalledWith("owner_preview_status", { p_workspace_id: workspaceId });
  });
  it("leaves the platform context without a selected workspace unchanged", async () => {
    const mock = client(); const actor = await resolveActorFromAuthenticatedClient(mock.instance);
    expect(actor?.profileId).toBe(profileId); expect(actor?.membership).toBeUndefined(); expect(actor?.preview).toBeUndefined(); expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("accepts explicit no-preview status without inventing a perspective", async () => {
    const actor = await resolveActorFromAuthenticatedClient(client({ status: null }).instance, workspaceId);
    expect(actor?.membership?.role).toBe("ADMIN"); expect(actor?.preview).toBeUndefined();
  });
  it.each([{ platformRole: "USER" }, { kind: "DEMO" }, { anonymous: true, kind: "DEMO" }, { memberActive: false }])("does not resolve Owner preview outside its actual identity and workspace boundary (%j)", async (options) => {
    const mock = client(options); await resolveActorFromAuthenticatedClient(mock.instance, workspaceId); expect(mock.rpc).not.toHaveBeenCalledWith("owner_preview_status", expect.anything());
  });
  it("fails closed when persisted preview is expired or invalid instead of restoring Admin writes", async () => {
    await expect(resolveActorFromAuthenticatedClient(client({ error: { code: "42501", message: "OWNER_PREVIEW_INVALID_EXIT_REQUIRED" } }).instance, workspaceId)).rejects.toThrow("Owner preview status unavailable");
  });
  it.each([{ ...preview, readOnly: false }, { ...preview, effectiveEmployeeProfileId: null }, { ...preview, role: "MANAGER" }, { ...preview, profileId }])("rejects a malformed status object (%j)", async (status) => {
    expect(await resolveActorFromAuthenticatedClient(client({ status }).instance, workspaceId)).toBeNull();
  });
});
